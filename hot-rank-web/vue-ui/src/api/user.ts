import { get, post } from '@/utils/request'

export interface UserInfo {
  id: number
  uuid: string
  email: string
  username?: string
  role: number
  status: number
  email_verified?: boolean
  created_at?: string
  last_login_at?: string | null
}

export interface AuthSuccessPayload {
  user: UserInfo
  token: string
}

export interface ApiResp<T> {
  code: number
  msg: string
  data: T
}

export const register = (payload: {
  email: string
  username?: string
  password: string
}): Promise<ApiResp<AuthSuccessPayload>> => {
  return post('/auth/register', payload)
}

export const login = (payload: {
  account?: string
  email?: string
  username?: string
  password: string
}): Promise<ApiResp<AuthSuccessPayload>> => {
  return post('/auth/login', payload)
}

export const fetchMe = (): Promise<ApiResp<UserInfo | null>> => {
  return get('/me')
}

