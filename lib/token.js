// Обновленный lib/token.js с лучшей диагностикой
import { SignJWT, jwtVerify } from "jose";

const ENC = new TextEncoder();

export async function signReviewToken(p) {
  try {
    console.log('[JWT] Signing token with payload:', { ...p, exp: p.exp });
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    
    const j = new SignJWT(p).setProtectedHeader({ alg: "HS256" });
    if (p.exp) j.setExpirationTime(p.exp);
    
    const token = await j.sign(ENC.encode(process.env.JWT_SECRET));
    console.log('[JWT] Token signed successfully, length:', token.length);
    
    return token;
  } catch (error) {
    console.error('[JWT] Error signing token:', error.message);
    throw error;
  }
}

export async function verifyReviewToken(token) {
  try {
    console.log('[JWT] Verifying token, length:', token?.length || 0);
    
    if (!token) {
      throw new Error('Token is required');
    }
    
    if (typeof token !== 'string') {
      throw new Error('Token must be a string');
    }
    
    // Проверяем базовую структуру JWT (должно быть 3 части разделенные точками)
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error(`Invalid JWT structure: expected 3 parts, got ${parts.length}`);
    }
    
    // Проверяем что каждая часть не пустая
    if (parts.some(part => !part || part.trim() === '')) {
      throw new Error('JWT contains empty parts');
    }
    
    console.log('[JWT] Token structure valid, parts lengths:', parts.map(p => p.length));
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    
    const { payload } = await jwtVerify(token, ENC.encode(process.env.JWT_SECRET));
    console.log('[JWT] Token verified successfully:', { 
      reviewerUserId: payload.reviewerUserId,
      role: payload.role,
      exp: payload.exp 
    });
    
    return payload;
  } catch (error) {
    console.error('[JWT] Error verifying token:', {
      message: error.message,
      tokenLength: token?.length || 0,
      tokenStart: token?.substring(0, 20) || 'undefined',
      hasSecret: !!process.env.JWT_SECRET
    });
    throw error;
  }
}