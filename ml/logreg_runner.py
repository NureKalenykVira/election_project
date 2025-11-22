import os
from dotenv import load_dotenv # type: ignore
import requests # type: ignore
import pandas as pd # type: ignore
from sklearn.linear_model import LogisticRegression # type: ignore

load_dotenv()

BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:5000")
ADMIN_API_TOKEN = os.getenv("ADMIN_API_TOKEN", "super-secret-admin-token-123")


def load_audit_logs():
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

    df_feat["blockNumber"] = pd.to_numeric(
        df["BlockNumber"], errors="coerce"
    ).fillna(0).astype("int64")

    df_feat["chainId"] = pd.to_numeric(
        df["ChainId"], errors="coerce"
    ).fillna(0).astype("int64")

    df_feat["candidateId"] = pd.to_numeric(
        df["CandidateId"], errors="coerce"
    ).fillna(0).astype("int64")

    created = pd.to_datetime(df["CreatedAt"], errors="coerce")
    created_int = created.astype("int64")
    df_feat["created_ts"] = (created_int // 10**9).fillna(0).astype("int64")

    return df_feat


def load_existing_anomalies():
    anomaly_ids = set()

    for method in ["IsolationForest", "KMeans"]:
        url = f"{BASE_URL}/ml/anomalies?method={method}"
        resp = requests.get(
            url,
            headers={"x-admin-token": ADMIN_API_TOKEN},
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"Warning: cannot load anomalies for method={method}, status={resp.status_code}")
            continue

        data = resp.json()
        for item in data:
            anomaly_ids.add(int(item["AuditLogId"]))

    return anomaly_ids


def build_labels(df_audit: pd.DataFrame, anomaly_ids: set) -> pd.Series:
    """Формуємо y: 1 якщо Id у anomaly_ids, інакше 0."""
    labels = df_audit["Id"].apply(
        lambda x: 1 if int(x) in anomaly_ids else 0
    ).astype("int64")
    return labels


def run_logistic_regression(features: pd.DataFrame, labels: pd.Series):
    if labels.sum() == 0 or labels.sum() == len(labels):
        print("Not enough class diversity for logistic regression (all 0 or all 1).")
        return None

    model = LogisticRegression(
        solver="liblinear",
        random_state=42,
    )
    model.fit(features, labels)

    proba = model.predict_proba(features)[:, 1]
    return proba


def send_flags_to_backend(df_audit: pd.DataFrame, proba, anomaly_ids_existing: set,
                          threshold: float = 0.7):
    anomalies = []

    for idx, row in df_audit.iterrows():
        audit_id = int(row["Id"])
        p = float(proba[idx])

        if p <= threshold:
            continue

        if audit_id in anomaly_ids_existing:
            continue

        anomalies.append(
            {
                "auditLogId": audit_id,
                "detectionMethod": "LogReg",
                "score": p,
                "label": "anomaly",
                "details": {
                    "probability": p,
                    "voterAddress": row.get("VoterAddress"),
                    "candidateId": row.get("CandidateId"),
                    "txHash": row.get("TxHash"),
                    "blockNumber": row.get("BlockNumber"),
                },
            }
        )

    if not anomalies:
        print("LogReg: no new anomalies above threshold.")
        return

    payload = {"items": anomalies}
    resp = requests.post(
        f"{BASE_URL}/ml/anomalies",
        json=payload,
        headers={"x-admin-token": ADMIN_API_TOKEN},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"LogReg anomalies sent, status: {resp.status_code}, count: {len(anomalies)}")


def main():
    df_audit = load_audit_logs()
    if df_audit.empty:
        print("No audit logs found.")
        return

    features = build_features(df_audit)

    anomaly_ids = load_existing_anomalies()
    if not anomaly_ids:
        print("No existing anomalies from IF/KMeans – nothing to train on.")
        return

    labels = build_labels(df_audit, anomaly_ids)

    proba = run_logistic_regression(features, labels)
    if proba is None:
        return

    send_flags_to_backend(df_audit, proba, anomaly_ids_existing=anomaly_ids, threshold=0.7)


if __name__ == "__main__":
    main()
