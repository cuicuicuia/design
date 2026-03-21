import axios from 'axios'
import type {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
const baseURL = import.meta.env.VITE_API_BASE_URL
// 创建axios实例
const request: AxiosInstance = axios.create({
  baseURL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
})

const TOKEN_KEY = 'hotrank_auth_token'

// 请求拦截器
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null
    if (token) {
      // 统一带上 Bearer token
      const headers = (config.headers ?? {}) as unknown as Record<string, string>
      headers.Authorization = `Bearer ${token}`
      config.headers = headers as unknown as InternalAxiosRequestConfig['headers']
    }
    return config
  },
  (error) => {
    console.error('Request Error:', error)
    return Promise.reject(error)
  },
)

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    // console.log('Response:', response.data)
    return response.data
  },
  (error) => {
    console.error('Response Error:', error)
    return Promise.reject(error)
  },
)

// 封装GET请求
export const get = <T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> => {
  return request.get(url, { params })
}

// 封装POST请求
export const post = <T = unknown>(url: string, data?: unknown): Promise<T> => {
  return request.post(url, data)
}

// 封装PUT请求
export const put = <T = unknown>(url: string, data?: unknown): Promise<T> => {
  return request.put(url, data)
}

// 封装DELETE请求
export const del = <T = unknown>(url: string): Promise<T> => {
  return request.delete(url)
}


export const AUTH_TOKEN_KEY = TOKEN_KEY

export default request
