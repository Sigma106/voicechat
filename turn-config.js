// openline TURN setup (public, client-side configuration).
// 1. Create a TURN credential at https://dashboard.metered.ca/
// 2. In Developers, locate your Metered domain, for example "myapp.metered.live".
// 3. In TURN → Credentials → Get credential → Show API Key,
//    copy ONLY that credential-scoped API key (never an account Secret Key).
// 4. Fill in the two values below and commit this file.
//
// Metered documents that this credential-scoped API key can be used in frontend
// code. It still grants access to your TURN allowance, so monitor usage.
window.OPENLINE_TURN_CONFIG = {
  domain: '',
  credentialApiKey: ''
};
