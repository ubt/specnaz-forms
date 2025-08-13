import { SignJWT, jwtVerify } from "jose";

const ENC = new TextEncoder();

export async function signReviewToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(payload.exp) // unix seconds
    .sign(ENC.encode(process.env.JWT_SECRET));
}

export async function verifyReviewToken(token) {
  const { payload } = await jwtVerify(token, ENC.encode(process.env.JWT_SECRET));
  return payload; // { employeeId, role, exp }
}
