# Supabase Auth email templates (Hebrew, RTL)

These replace Supabase's default English sign-in emails. Paste each template's HTML into
**Supabase → Authentication → Emails → Templates**, and set its subject:

| Template in Supabase | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | אימות כתובת האימייל – ניהול בניין |
| Reset password | `reset-password.html` | איפוס סיסמה – ניהול בניין |
| Magic link | `magic-link.html` | קישור כניסה – ניהול בניין |
| Change email address | `change-email.html` | אישור שינוי אימייל – ניהול בניין |
| Invite user | `invite.html` | הזמנה לאפליקציית ניהול הבניין |

They use Supabase's variables `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` (Supabase fills them in
when sending). Layout uses tables and inline styles so it renders in Gmail, Outlook and phone mail apps.

Also set **Authentication → URL Configuration → Site URL** to `https://itaibech.github.io/buildingManagement/`
so links never fall back to `localhost`.
