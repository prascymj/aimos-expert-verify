// Deployment settings. Both values are public by design: the API refuses every request that does not carry
// a valid Google ID token of a person listed in the project's raters sheet.
window.AEV_CONFIG = {
  mock: false,
  clientId: '',   // OAuth 2.0 Client ID (Web application) from Google Cloud Console
  apiUrl: ''      // Apps Script Web app URL ending in /exec
};
