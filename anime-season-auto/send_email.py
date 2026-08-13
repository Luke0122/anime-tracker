# -*- coding: utf-8 -*-
"""通过 QQ 邮箱 SMTP 发送带附件的邮件。"""
import os
import smtplib
from email.header import Header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def send_email(cfg, subject, body, attachments, logger=None, html_body=None):
    user = cfg.get("smtp_user", "")
    code = cfg.get("smtp_auth_code", "")
    to = cfg.get("mail_to", "")
    cc = cfg.get("mail_cc") or []
    if isinstance(cc, str):
        cc = [cc]
    cc = [c for c in cc if c and c != to]
    extra = cfg.get("mail_extra_to") or []
    if isinstance(extra, str):
        extra = [extra]
    extra = [e for e in extra if e and e != to]
    if not user or not code:
        raise RuntimeError("config.json 未配置 smtp_user / smtp_auth_code，已跳过发送")
    msg = MIMEMultipart()
    msg["From"] = user
    msg["To"] = to
    if cc or extra:
        msg["Cc"] = ", ".join(cc + extra)
    msg["Subject"] = Header(subject, "utf-8")
    if html_body:
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body, "plain", "utf-8"))
        alt.attach(MIMEText(html_body, "html", "utf-8"))
        msg.attach(alt)
    else:
        msg.attach(MIMEText(body, "plain", "utf-8"))
    for path in attachments:
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            part = MIMEApplication(f.read())
        fname = os.path.basename(path)
        part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", fname))
        msg.attach(part)
    host = cfg.get("smtp_host", "smtp.qq.com")
    port = int(cfg.get("smtp_port", 465))
    if logger:
        logger.info("发送邮件至 %s（主题：%s）", to, subject)
    with smtplib.SMTP_SSL(host, port, timeout=60) as srv:
        srv.login(user, code)
        srv.sendmail(user, [to] + cc + extra, msg.as_string())
    if logger:
        logger.info("邮件发送成功：%s", subject)
    return True
