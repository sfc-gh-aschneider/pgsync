"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"

interface Instance {
  INSTANCE_ID: number
  INSTANCE_NAME: string
  PG_HOST: string
  PG_PORT: number
  PG_DATABASE: string
  PG_SERVICE_USER: string
  SECRET_NAME: string
  NETWORK_RULE_NAME: string | null
  EAI_NAME: string | null
  ENABLED: boolean
  NOTES: string | null
}

interface InstanceContextType {
  instances: Instance[]
  selectedInstance: number
  setSelectedInstance: (id: number) => void
  selectedInstanceName: string
  loading: boolean
  refresh: () => void
}

const InstanceContext = createContext<InstanceContextType>({
  instances: [],
  selectedInstance: 1,
  setSelectedInstance: () => {},
  selectedInstanceName: "",
  loading: true,
  refresh: () => {},
})

export function useInstance() {
  return useContext(InstanceContext)
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedInstance, setSelectedInstance] = useState(1)
  const [loading, setLoading] = useState(true)

  const fetchInstances = useCallback(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then(data => {
        const insts = data.instances || []
        setInstances(insts)
        if (insts.length > 0 && !insts.find((i: Instance) => i.INSTANCE_ID === selectedInstance)) {
          setSelectedInstance(insts[0].INSTANCE_ID)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selectedInstance])

  useEffect(() => {
    fetchInstances()
  }, [])

  const selectedInstanceName = instances.find(i => i.INSTANCE_ID === selectedInstance)?.INSTANCE_NAME || ""

  return (
    <InstanceContext.Provider value={{ instances, selectedInstance, setSelectedInstance, selectedInstanceName, loading, refresh: fetchInstances }}>
      {children}
    </InstanceContext.Provider>
  )
}
