import os
from dotenv import load_dotenv # type: ignore
import requests # type: ignore
import pandas as pd # type: ignore
import numpy as np

from sklearn.preprocessing import StandardScaler # type: ignore
from sklearn.cluster import KMeans # type: ignore

load_dotenv()

BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:5000")
ADMIN_API_TOKEN = os.getenv("ADMIN_API_TOKEN", "super-secret-admin-token-123")


def load_audit_logs() -> pd.DataFrame:
    url = f"{BASE_URL}/audit/export"
    resp = requests.get(
        url,
        headers={
            "x-admin-token": ADMIN_API_TOKEN,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    items = data.get("items", data)
    df = pd.DataFrame(items)
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df_feat = pd.DataFrame()
    df_feat["blockNumber"] = pd.to_numeric(df["BlockNumber"], errors="coerce").fillna(0)
    df_feat["chainId"] = pd.to_numeric(df["ChainId"], errors="coerce").fillna(0)

    df_feat["candidateId"] = (
        pd.to_numeric(df["CandidateId"], errors="coerce")
        .fillna(0)
        .astype("int64")
    )

    created = pd.to_datetime(df["CreatedAt"], errors="coerce")
    df_int = created.astype("int64")
    df_feat["created_ts"] = (df_int // 10**9).fillna(0).astype("int64")

    return df_feat


def run_kmeans(features: pd.DataFrame, n_clusters: int = 3, anomaly_quantile: float = 0.95) -> pd.DataFrame:
    if features.empty:
        raise ValueError("No features to cluster")

    scaler = StandardScaler()
    X = scaler.fit_transform(features)

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
    kmeans.fit(X)

    distances = kmeans.transform(X).min(axis=1)
    clusters = kmeans.labels_

    threshold = np.quantile(distances, anomaly_quantile)
    is_anomaly = distances >= threshold

    result = pd.DataFrame(
        {
            "cluster": clusters,
            "distance": distances,
            "score": distances, 
            "label": np.where(is_anomaly, "anomaly", "normal"),
        },
        index=features.index,
    )
    return result


def send_flags_to_backend(df_audit: pd.DataFrame, results: pd.DataFrame) -> None:
    anomalies = []

    for idx, res_row in results.iterrows():
        if res_row["label"] != "anomaly":
            continue

        audit_row = df_audit.loc[idx]

        anomalies.append(
            {
                "auditLogId": int(audit_row["Id"]),
                "detectionMethod": "KMeans",
                "score": float(res_row["score"]),
                "label": "anomaly",
                "details": {
                    "cluster": int(res_row["cluster"]),
                    "distance": float(res_row["distance"]),
                    "voterAddress": audit_row.get("VoterAddress"),
                    "candidateId": audit_row.get("CandidateId"),
                    "txHash": audit_row.get("TxHash"),
                    "blockNumber": audit_row.get("BlockNumber"),
                },
            }
        )

    if not anomalies:
        print("No KMeans anomalies to send")
        return

    payload = {"items": anomalies}

    resp = requests.post(
        f"{BASE_URL}/ml/anomalies",
        json=payload,
        headers={
            "x-admin-token": ADMIN_API_TOKEN,
        },
        timeout=30,
    )
    resp.raise_for_status()
    print(f"KMeans anomalies sent, status: {resp.status_code}, count: {len(anomalies)}")


def main():
    df_audit = load_audit_logs()

    if df_audit.empty:
        print("No audit logs found")
        return

    features = build_features(df_audit)

    if features.empty:
        print("No features built from audit logs")
        return

    results = run_kmeans(features, n_clusters=3, anomaly_quantile=0.95)
    send_flags_to_backend(df_audit, results)


if __name__ == "__main__":
    main()
