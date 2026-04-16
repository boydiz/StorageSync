export interface Bin {
  id: string
  binNumber: number
  name: string
  location: string
  description: string
  color: string
  createdAt: string
  userId: string
}

export interface Item {
  id: string
  name: string
  quantity: number
  description: string
  binId: string
  userId: string
  createdAt: string
}

export interface AppSettings {
  id: string
  userId: string
  appName: string
  appDescription: string
  logoDataUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface SharedUser {
  id: string
  ownerId: string
  sharedWithUserId: string
  email?: string
  createdAt: string
}

export type UserRole = 'admin' | 'viewer'
