async function verifyRecaptcha(token, remoteip) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) throw new Error("Missing RECAPTCHA_SECRET");

  try {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
    if (remoteip) params.set("remoteip", remoteip);

    const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await resp.json();
    return !!json.success;
  } catch {
    return false;
  }
}
module.exports = { verifyRecaptcha };
