import os
import requests
from flask import Flask, request

app = Flask(_name_)

VERIFY_TOKEN = os.environ.get("VERIFY_TOKEN")
PAGE_ACCESS_TOKEN = os.environ.get("PAGE_ACCESS_TOKEN")

@app.route("/")
def home():
    return "Math Solver AI is running!"

@app.route("/webhook", methods=["GET"])
def verify():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        return challenge, 200

    return "Verification failed", 403

@app.route("/webhook", methods=["POST"])
def webhook():
    data = request.get_json()

    if data and data.get("object") == "page":
        for entry in data.get("entry", []):
            for event in entry.get("messaging", []):
                sender = event.get("sender", {}).get("id")
                message = event.get("message", {}).get("text")

                if sender and message and not event.get("message", {}).get("is_echo"):
                    reply = solve_math(message)
                    send_message(sender, reply)

    return "EVENT_RECEIVED", 200

def solve_math(text):
    try:
        import sympy
        from sympy import sympify

        expression = sympify(text, evaluate=True)
        return f"الحل: {expression}"
    except Exception:
        return "ما قدرت أفهم المسألة. أرسلها بشكل رياضي واضح مثل: 25*48"

def send_message(user_id, text):
    if not PAGE_ACCESS_TOKEN:
        return

    url = "https://graph.facebook.com/v23.0/me/messages"
    requests.post(
        url,
        params={"access_token": PAGE_ACCESS_TOKEN},
        json={
            "recipient": {"id": user_id},
            "message": {"text": text}
        },
        timeout=15
    )
