import { SignJWT, jwtVerify } from "jose";

const ENC = new TextEncoder();

export async function signReviewToken(p) {
  const j = new SignJWT(p).setProtectedHeader({ alg: "HS256" });
  if (p.exp) j.setExpirationTime(p.exp); // exp необязателен
  return j.sign(ENC.encode(process.env.JWT_SECRET));
}


export async function verifyReviewToken(token) {
  const { payload } = await jwtVerify(token, ENC.encode(process.env.JWT_SECRET));
  return payload; // { employeeId, role, exp }
}
