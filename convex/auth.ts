import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      validatePasswordRequirements: (password) => {
        if (password.length < 4) {
          throw new Error("Password must be at least 4 characters");
        }
      },
      profile: (params) => {
        const email = String(params.email ?? "");
        const name =
          String(params.name ?? "").trim() || email.split("@")[0] || "Player";
        return { email, name };
      },
    }),
  ],
});
