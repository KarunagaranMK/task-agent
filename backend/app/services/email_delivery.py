"""Optional SMTP delivery for HR-approved employee messages."""
from __future__ import annotations

from datetime import datetime
from email.message import EmailMessage
import logging
import smtplib
import ssl

from sqlmodel import Session

from app.config import settings
from app.db.database import commit_now
from app.domain.models import MailOutbox


logger = logging.getLogger(__name__)


def deliver_outbox_message(session: Session, message: MailOutbox) -> bool:
    """Deliver one explicitly HR-queued message when SMTP is configured.

    Returns False when SMTP is not configured or delivery fails; the persisted
    message remains queued so the HR team can retry it after configuration or
    service recovery.
    """
    sender = settings.SMTP_FROM or settings.SMTP_USERNAME
    if not settings.SMTP_HOST or not sender:
        return False

    email = EmailMessage()
    email["From"] = sender
    email["To"] = message.recipient
    email["Subject"] = message.subject
    email.set_content(message.body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as client:
            if settings.SMTP_STARTTLS:
                client.starttls(context=ssl.create_default_context())
            if settings.SMTP_USERNAME:
                client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
            client.send_message(email)
    except (OSError, smtplib.SMTPException, ssl.SSLError) as exc:
        logger.warning("Employee email delivery failed for outbox item %s (%s)", message.public_id, type(exc).__name__)
        return False

    message.sent_at = datetime.utcnow()
    session.add(message)
    commit_now(session)
    return True
