// app/api/debug/token/[token]/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { listEvaluateesForReviewerUser, notion } from "@/lib/notion";

export async function GET(req, { params }) {
  try {
    const token = params.token;
    
    // Проверка токена
    let payload;
    try {
      payload = await verifyReviewToken(token);
    } catch (error) {
      return NextResponse.json({
        error: 'Token verification failed',
        details: error.message
      }, { status: 401 });
    }
    
    const reviewerUserId = payload?.reviewerUserId;
    if (!reviewerUserId) {
      return NextResponse.json({
        error: 'No reviewerUserId in token'
      }, { status: 400 });
    }
    
    // Проверка пользователя
    let user;
    try {
      user = await notion.users.retrieve({ user_id: reviewerUserId });
    } catch (error) {
      return NextResponse.json({
        error: 'User not found in Notion',
        details: error.message
      }, { status: 404 });
    }
    
    // Вызов основной функции
    let employees;
    try {
      employees = await listEvaluateesForReviewerUser(reviewerUserId);
    } catch (error) {
      return NextResponse.json({
        error: 'Failed to load employees',
        details: error.message,
        stack: error.stack
      }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      token: {
        reviewerUserId,
        role: payload.role,
        teamName: payload.teamName
      },
      user: {
        id: user.id,
        name: user.name,
        type: user.type
      },
      employees: {
        count: employees.length,
        list: employees.map(e => ({
          id: e.employeeId,
          name: e.employeeName,
          role: e.role
        }))
      }
    });
    
  } catch (error) {
    return NextResponse.json({
      error: 'Critical error',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}