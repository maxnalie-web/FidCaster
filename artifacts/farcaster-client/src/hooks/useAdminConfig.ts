import { useState, useEffect, useCallback } from "react";
import { loadAdminConfig, saveAdminConfig, type AdminConfig } from "@/lib/admin-config";

export function useAdminConfig(): [AdminConfig, (updater: (prev: AdminConfig) => AdminConfig) => void] {
  const [cfg, setCfg] = useState<AdminConfig>(loadAdminConfig);

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<AdminConfig>).detail;
      if (detail) setCfg(detail);
    }
    window.addEventListener("fc_admin_cfg_change", onUpdate);
    return () => window.removeEventListener("fc_admin_cfg_change", onUpdate);
  }, []);

  const update = useCallback((updater: (prev: AdminConfig) => AdminConfig) => {
    setCfg((prev) => {
      const next = updater(prev);
      saveAdminConfig(next);
      return next;
    });
  }, []);

  return [cfg, update];
}

export function useAdminConfigValue(): AdminConfig {
  const [cfg] = useAdminConfig();
  return cfg;
}
