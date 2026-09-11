import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    // The OTP delivery key is read from the environment. It was previously
    // hardcoded here and committed to source control; the literal is kept out
    // of the repository now. Configure OTP_EMAIL_API_KEY in the Convex
    // deployment environment.
    const apiKey = process.env.OTP_EMAIL_API_KEY;
    if (!apiKey) {
      // Fail loudly rather than silently not sending a sign-in code.
      throw new Error(
        "OTP email delivery is not configured: OTP_EMAIL_API_KEY is missing.",
      );
    }

    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
    } catch (error) {
      // Never echo the request (it carries the OTP and the API key) into an
      // error message that could reach a client or a log sink.
      const status =
        axios.isAxiosError(error) && error.response
          ? ` (HTTP ${error.response.status})`
          : "";
      throw new Error(`Failed to send verification email${status}.`);
    }
  },
});
