Merchant tipping follow-up:

- Add a dedicated merchant tipping account field in the shared app backend data model.
- Expose that tipping account in the public merchant payload used by mobile and web.
- Let merchants configure/manage the tipping account from the web wallet.
- Add mobile pay UX so a user can tap `Pay merchant`, enter a tip, and send merchant payment + tip cleanly.
- Decide whether merchant payment and tip should be one transaction with encoded split support or two coordinated transfers.
