"""
NexaBank — ML Fraud Detection Service (Flask)
Run: python app.py
Endpoint: POST /predict
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import random
import math
from datetime import datetime

app = Flask(__name__)
CORS(app)

# ── Simple Rule + Heuristic ML Model ─────────────────────────
# In production, replace this with a trained scikit-learn model
# loaded via: model = joblib.load('fraud_model.pkl')

def compute_risk_score(amount, hour, frequency, location):
    """
    Heuristic fraud scoring (simulates ML model output).
    Replace with actual trained model prediction.
    """
    score = 0.0

    # Feature 1: Amount risk
    if amount > 100000:
        score += 0.35
    elif amount > 50000:
        score += 0.20
    elif amount > 10000:
        score += 0.08

    # Feature 2: Time-of-day risk
    if 22 <= hour or hour <= 4:    # Late night
        score += 0.25
    elif 5 <= hour <= 7:           # Early morning
        score += 0.12

    # Feature 3: Transaction frequency risk
    if frequency >= 10:
        score += 0.30
    elif frequency >= 5:
        score += 0.18
    elif frequency >= 3:
        score += 0.08

    # Feature 4: Location risk
    high_risk_locations = ['russia', 'unknown', 'tor', 'proxy', 'vpn', 'china', 'north korea']
    if any(loc in location.lower() for loc in high_risk_locations):
        score += 0.35

    # Feature 5: Combined features (interaction)
    if amount > 50000 and (22 <= hour or hour <= 4):
        score += 0.15  # Night + large amount = higher risk

    if frequency >= 5 and amount > 20000:
        score += 0.10  # Rapid + large = higher risk

    # Add small random noise to simulate model uncertainty
    score += random.uniform(-0.02, 0.02)

    # Clamp to [0, 1]
    score = max(0.0, min(1.0, score))
    return score


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':    'OK',
        'service':   'NexaBank ML Fraud Detection',
        'version':   '1.0.0',
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/predict', methods=['POST'])
def predict():
    """
    Input JSON:
        amount    (float)  — transaction amount
        hour      (int)    — hour of transaction (0-23)
        frequency (int)    — number of transactions in last 10 minutes
        location  (string) — transaction location

    Output JSON:
        fraud       (bool)   — is fraudulent
        risk_score  (int)    — 0-100 risk score
        probability (float)  — model confidence [0-1]
        features    (dict)   — feature importances
    """
    try:
        data      = request.get_json()
        amount    = float(data.get('amount',    0))
        hour      = int(data.get('hour',        datetime.now().hour))
        frequency = int(data.get('frequency',   0))
        location  = str(data.get('location',    'Unknown'))

        probability = compute_risk_score(amount, hour, frequency, location)
        risk_score  = int(probability * 100)
        is_fraud    = probability >= 0.50

        return jsonify({
            'fraud':       is_fraud,
            'risk_score':  risk_score,
            'probability': round(probability, 4),
            'features': {
                'amount_risk':    round(min(amount / 100000, 1.0), 3),
                'time_risk':      round(abs(hour - 12) / 12, 3),
                'frequency_risk': round(min(frequency / 10, 1.0), 3),
                'location_risk':  0.9 if any(l in location.lower() for l in ['russia','unknown','tor']) else 0.1,
            },
            'model': 'heuristic_v1',
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/batch-predict', methods=['POST'])
def batch_predict():
    """Batch prediction for multiple transactions."""
    try:
        transactions = request.get_json().get('transactions', [])
        results = []
        for txn in transactions:
            prob       = compute_risk_score(
                float(txn.get('amount', 0)),
                int(txn.get('hour', 12)),
                int(txn.get('frequency', 0)),
                str(txn.get('location', 'Unknown'))
            )
            results.append({
                'id':         txn.get('id'),
                'fraud':      prob >= 0.50,
                'risk_score': int(prob * 100),
            })
        return jsonify({'results': results, 'count': len(results)})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


if __name__ == '__main__':
    print("""
  ╔══════════════════════════════════════════╗
  ║  NexaBank ML Fraud Detection Service     ║
  ║  Running on http://localhost:5001        ║
  ║  Endpoint: POST /predict                 ║
  ╚══════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=5001, debug=True)
