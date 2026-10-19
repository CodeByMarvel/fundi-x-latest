/**
 * Stands in for the app's '@env' (react-native-dotenv) when server tests
 * run the app's own server client. Read when first imported, so set
 * TEST_API_URL before importing the client.
 */
export const API_URL = process.env.TEST_API_URL;
