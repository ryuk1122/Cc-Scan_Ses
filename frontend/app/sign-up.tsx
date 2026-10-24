import React from "react";
import { Redirect } from "expo-router";

// Public account creation is disabled. Admin provisions operator accounts.
export default function SignUp() {
  return <Redirect href="/sign-in" />;
}
