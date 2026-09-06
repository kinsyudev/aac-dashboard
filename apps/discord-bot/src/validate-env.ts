import { botEnv } from "./env";

// Builds must check deployment configuration even when CI normally skips it.
botEnv({ skipValidation: false });
console.log("Discord bot environment validated.");
