import os
import argparse
from dotenv import load_dotenv # type: ignore
import requests # type: ignore
import pandas as pd # type: ignore
from sklearn.ensemble import IsolationForest  # type: ignore

load_dotenv()

BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:5000")
ADMIN_API_TOKEN = os.getenv("ADMIN_API_TOKEN", "super-secret-admin-token-123")


def load_audit_logs(election_id: int | None = None) -> pd.DataFrame:
    if election_id is not None:
        url = f"{BASE_URL}/audit/election/{election_id}"
        resp = requests.get(
            url,
            headers={"x-admin-token": ADMIN_API_TOKEN},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return pd.DataFrame(data)

    url = f"{BASE_URL}/audit/export"
    resp = requests.get(
        url,
        headers={"x-admin-token": ADMIN_API_TOKEN},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    items = data.get("items", data)
    return pd.DataFrame(items)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df_feat = pd.DataFrame()
    df_feat["blockNumber"] = df["BlockNumber"]
    df_feat["chainId"] = df["ChainId"]
    df_feat["candidateId"] = (
        pd.to_numeric(df["CandidateId"], errors="coerce")
        .fillna(0)
        .astype("int64")
    )
    df_feat["created_ts"] = pd.to_datetime(df["CreatedAt"]).astype("int64") // 10**9
    return df_feat


def run_isolation_forest(features: pd.DataFrame) -> pd.DataFrame:
    model = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42,
    )
    model.fit(features)

    scores = -model.score_samples(features)
    labels = model.predict(features)

    return pd.DataFrame(
        {
            "score": scores,
            "label": ["anomaly" if l == -1 else "normal" for l in labels],
        }
    )


def send_flags_to_backend(df_audit, results, election_id: int | None = None):
    anomalies = []
    for idx, row in df_audit.iterrows():
        if results.iloc[idx]["label"] != "anomaly":
            continue

        anomalies.append(
            {
                "auditLogId": int(row["Id"]),
                "detectionMethod": "IsolationForest",
                "score": float(results.iloc[idx]["score"]),
                "label": "anomaly",
                "details": {
                    "electionId": int(row.get("BlockchainElectionId"))
                    if row.get("BlockchainElectionId") is not None
                    else election_id,
                    "voterAddress": row.get("VoterAddress"),
                    "candidateId": row.get("CandidateId"),
                    "txHash": row.get("TxHash"),
                    "blockNumber": row.get("BlockNumber"),
                },
            }
        )

    if not anomalies:
        print("No anomalies to send")
        return

    payload = {"items": anomalies}

    resp = requests.post(
        f"{BASE_URL}/ml/anomalies",
        json=payload,
        headers={"x-admin-token": ADMIN_API_TOKEN},
        timeout=30,
    )
    resp.raise_for_status()
    print("Anomalies sent, status:", resp.status_code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--election-id",
        type=int,
        help="BlockchainElectionId для аналізу (якщо не заданий - аналіз всіх логів)",
    )
    args = parser.parse_args()

    df_audit = load_audit_logs(args.election_id)

    if df_audit.empty:
        print("No audit logs to analyze")
        return

    features = build_features(df_audit)
    results = run_isolation_forest(features)
    send_flags_to_backend(df_audit, results, election_id=args.election_id)


if __name__ == "__main__":
    main()