import os
import sys
import json
import requests # type: ignore
import pandas as pd # type: ignore
from sklearn.ensemble import IsolationForest # type: ignore
from sklearn.cluster import KMeans  # type: ignore
from dotenv import load_dotenv # type: ignore

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")

if not ADMIN_TOKEN:
    print("ADMIN_TOKEN is not set in .env", file=sys.stderr)
    sys.exit(1)


def get_election_status(election_id: int):
    """Перевірка, що вибори фіналізовані (через бекенд-ендпоінт статусу з блокчейну)."""
    url = f"{BACKEND_URL}/elections/{election_id}/status"
    resp = requests.get(url)
    resp.raise_for_status()
    return resp.json()


def get_audit_for_election(election_id: int):
    """Забрати всі події по виборах із бекенду (офчейн AuditLog)."""
    url = f"{BACKEND_URL}/audit/election/{election_id}"
    resp = requests.get(
        url,
        headers={"x-admin-token": ADMIN_TOKEN},
    )
    resp.raise_for_status()
    return resp.json()


def build_features_per_address(events):
    """Агрегуємо події до рівня адреси (для KMeans + IsolationForest)."""
    df = pd.DataFrame(events)
    if df.empty:
        return pd.DataFrame(), {}

    df["CreatedAt"] = pd.to_datetime(df["CreatedAt"])

    if "CandidateId" in df.columns:
        df["CandidateId"] = df["CandidateId"].fillna(0).astype(int)
    else:
        df["CandidateId"] = 0

    grp = df.groupby("VoterAddress")

    features = pd.DataFrame()
    features["total_events"] = grp.size()
    features["total_commits"] = grp["EventType"].apply(
        lambda s: (s == "VoteCommitted").sum()
    )
    features["total_reveals"] = grp["EventType"].apply(
        lambda s: (s == "VoteRevealed").sum()
    )
    features["total_grants"] = grp["EventType"].apply(
        lambda s: (s == "VotingRightGranted").sum()
    )
    features["total_revokes"] = grp["EventType"].apply(
        lambda s: (s == "VotingRightRevoked").sum()
    )

    features["num_candidates"] = grp["CandidateId"].nunique()

    features["first_action_ts"] = grp["CreatedAt"].min().astype("int64") // 10**9
    features["last_action_ts"] = grp["CreatedAt"].max().astype("int64") // 10**9
    features["activity_duration"] = (
        features["last_action_ts"] - features["first_action_ts"]
    )

    first_event_map = {}
    for addr, group in grp:
        first_event_map[addr] = int(group.sort_values("CreatedAt").iloc[0]["Id"])

    return features, first_event_map


def run_isolation_forest(features: pd.DataFrame):
    if features.empty:
        return pd.Series(dtype=float)
    model = IsolationForest(
        n_estimators=100,
        contamination=0.05, 
        random_state=42,
    )
    model.fit(features)
    scores = model.decision_function(features) 
    return pd.Series(scores, index=features.index)


def run_kmeans(features: pd.DataFrame, k: int = 3):
    if features.empty:
        return pd.Series(dtype=int), pd.Series(dtype=float)
    model = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = model.fit_predict(features)
    centers = model.cluster_centers_
    dists = []
    for idx, row in features.iterrows():
        cluster = labels[features.index.get_loc(idx)]
        center = centers[cluster]
        dist = ((row.values - center) ** 2).sum() ** 0.5
        dists.append(dist)
    return pd.Series(labels, index=features.index), pd.Series(dists, index=features.index)


def post_anomalies(election_id: int, items):
    if not items:
        print("No anomalies to send.")
        return
    url = f"{BACKEND_URL}/ml/anomalies"
    payload = {"items": items}
    resp = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "x-admin-token": ADMIN_TOKEN,
        },
        data=json.dumps(payload),
    )
    resp.raise_for_status()
    print("Anomalies inserted:", resp.json())


def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_election.py <electionId>", file=sys.stderr)
        sys.exit(1)

    election_id = int(sys.argv[1])

    status = get_election_status(election_id)
    if not status.get("finalized"):
        print(f"Election {election_id} is not finalized yet, aborting.")
        sys.exit(0)

    events = get_audit_for_election(election_id)
    print(f"Loaded {len(events)} audit events for election {election_id}")

    features, first_event_map = build_features_per_address(events)
    if features.empty:
        print("No features (no events?)")
        sys.exit(0)

    iso_scores = run_isolation_forest(features)

    k_labels, k_dists = run_kmeans(features)

    items = []
    threshold_iso = iso_scores.quantile(0.05)

    for addr, score in iso_scores.items():
        if score <= threshold_iso:
            items.append(
                {
                    "auditLogId": first_event_map[addr],
                    "detectionMethod": "IsolationForest",
                    "score": float(score),
                    "label": "anomaly",
                    "details": {
                        "address": addr,
                        "features": features.loc[addr].to_dict(),
                    },
                }
            )

    if not k_dists.empty:
        thr_k = k_dists.quantile(0.95)
        for addr, dist in k_dists.items():
            if dist >= thr_k:
                items.append(
                    {
                        "auditLogId": first_event_map[addr],
                        "detectionMethod": "KMeans",
                        "score": float(dist),
                        "label": "cluster_outlier",
                        "details": {
                            "address": addr,
                            "clusterId": int(k_labels[addr]),
                            "distanceToCentroid": float(dist),
                        },
                    }
                )

    post_anomalies(election_id, items)


if __name__ == "__main__":
    main()
