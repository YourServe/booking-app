const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.checkGiftCard = functions.https.onCall(async (data, context) => {
  // 1. Get the gift card code from the client app
  const giftCardCode = data.code;
  if (!giftCardCode) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "The function must be called with a 'code' argument.",
    );
  }

  // 2. Securely get the API key from environment variables
  // Make sure you have set this in the Google Cloud Console!
  const apiKey = process.env.GIFTUP_API_KEY;
  if (!apiKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The GiftUp API key is not configured.",
    );
  }

  // 3. Call the GiftUp API
  const url = `https://api.giftup.app/v1/gift-cards/${giftCardCode}`;

  try {
    const response = await axios.get(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    // 4. Return only the necessary, non-sensitive data to the client
    const { currentValue, initialValue, redeemable, redemptionCode } = response.data;
    return { currentValue, initialValue, redeemable, redemptionCode };

  } catch (error) {
    // Handle errors from the GiftUp API
    if (error.response) {
      if (error.response.status === 404) {
        throw new functions.https.HttpsError("not-found", "Gift card not found.");
      }
      // Forward other API errors
      throw new functions.https.HttpsError("unknown", "An error occurred with the GiftUp API.");
    }
    // Handle network errors
    throw new functions.https.HttpsError("unavailable", "Could not connect to the GiftUp API.");
  }
});