// Pre-sign-up trigger for the workforce console User Pool.
//
// Cognito calls this once per federated sign-up to decide whether to
// create the user. We reject any Google identity whose email doesn't
// match the OperatorEmail parameter — that's the practical
// "single-operator scale" (C-3) restriction for the console.
//
// Matched calls auto-confirm + auto-verify so the operator skips the
// email-confirmation step their Google identity already covers.

import type {
  PreSignUpTriggerEvent,
  PreSignUpTriggerHandler,
} from "aws-lambda";

export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent,
) => {
  const allowed = (process.env.ALLOWED_EMAIL ?? "").toLowerCase();
  const email = (event.request?.userAttributes?.email ?? "").toLowerCase();
  if (!allowed || !email || email !== allowed) {
    throw new Error("not an authorised operator");
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
