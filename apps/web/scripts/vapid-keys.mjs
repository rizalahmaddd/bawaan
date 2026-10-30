// Prints a fresh VAPID key pair in the format .dev.vars and `wrangler secret put` expect.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const privateJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_JWK=${privateJwk}`);
