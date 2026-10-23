# Two-step verification with Microsoft Authenticator — user guide

OCTA BMS uses a standard 6-digit authenticator code (TOTP) in addition to your password.
Microsoft Authenticator works out of the box; any RFC 6238 app (e.g. 1Password,
Bitwarden) works the same way.

## Set up (about 2 minutes)

You get to the setup screen either automatically after signing in (when your organization
requires it) or from **your initials (top right) → Security → Set up authenticator**.
If you start it from the Security page you may be asked for your password first.

1. Open **Microsoft Authenticator** on your phone.
2. Tap **+** → **Other account (Google, Facebook, etc.)**.
   Do *not* choose "Work or school account" — that is for Microsoft 365 sign-in.
3. Select **Start setup** in OCTA BMS and scan the QR code.
   Can't scan? Open **"Can't scan? Enter this key manually"** in OCTA BMS and in the app choose
   *Enter code manually*: account name = your email, key = the shown key (spaces are fine),
   type = time-based.
4. The app now shows **OCTA BMS** with a 6-digit code that changes every 30 seconds.
   Type the current code into OCTA BMS and select **Confirm and activate**.
5. **Save your 10 recovery codes.** Download the `.txt` or copy them into your password
   manager (or print them and lock them away), tick the confirmation box, continue.
   They are shown only this once.

## Signing in afterwards

Email + password → OCTA BMS asks for the 6-digit code → open Microsoft Authenticator →
enter the code for *OCTA BMS*. Browsers and password managers may offer to fill the code.

If a code is rejected: wait for the next code (each code works once), and make sure your
phone's clock is set automatically (*Settings → Date & time → automatic*).

## Lost or new phone

* **New phone, old one still works:** Security → **Replace authenticator** (confirm with a
  current code), then scan the new QR code with the new phone. The old entry stops working.
* **Phone lost:** on the code screen choose **Use a recovery code instead** and enter one of
  your saved codes (each works once). Then go to Security → **Replace authenticator** and
  **Generate new codes**.
* **Phone and recovery codes lost:** contact your OCTA BMS administrator. They will verify
  your identity in person or by video call and start a reset that a *second* administrator
  must approve. You will then set up the authenticator again. Email alone can never reset it.

## Good to know

* Never tell anyone your code or recovery codes — OCTA BMS staff will never ask for them.
* A code protects against stolen passwords, but not against fake login pages. Always check
  the address bar shows your company's OCTA BMS address before entering a code.
* Security → *Signed-in sessions* lets you sign out devices you no longer use.
