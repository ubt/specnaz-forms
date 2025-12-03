// lib/token.js - JWT токены для ревьюеров
import { SignJWT, jwtVerify } from "jose";
import { logger } from "./logger";

const ENC = new TextEncoder();

export async function signReviewToken(payload) {
  try {
    logger.debug('[JWT] Signing token:', { reviewerUserId: payload.reviewerUserId });
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET not set');
    }
    
    const jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
    
    if (payload.exp) {
      jwt.setExpirationTime(payload.exp);
    }
    
    const token = await jwt.sign(ENC.encode(process.env.JWT_SECRET));
    logger.debug('[JWT] Token signed, length:', token.length);
    
    return token;
  } catch (error) {
    logger.error('[JWT] Sign error:', error.message);
    throw error;
  }
}

export async function verifyReviewToken(token) {
  try {
    if (!token || typeof token !== 'string') {
      throw new Error('Token is required');
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error(`Invalid JWT structure: expected 3 parts, got ${parts.length}`);
    }
    
    if (parts.some(part => !part?.trim())) {
      throw new Error('JWT contains empty parts');
    }
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET not set');
    }
    
    const { payload } = await jwtVerify(token, ENC.encode(process.env.JWT_SECRET));
    
    logger.debug('[JWT] Token verified:', { 
      reviewerUserId: payload.reviewerUserId,
      role: payload.role
    });
    
    return payload;
  } catch (error) {
    logger.error('[JWT] Verify error:', error.message);
    throw error;
  }
}
