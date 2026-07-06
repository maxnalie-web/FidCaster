import { useState, useEffect, useCallback } from "react";
import { loadAdminConfig, saveAdminConfig, refreshAdminConfigFromServer, type AdminConfig } from "@/lib/admin-config";

/** Every mounted consumer refreshes from the server once per app load — the
 * first one in wins, the rest just wait for its "fc_admin_cfg_change" event. */
let _refreshed = false;

export function useAdminConfig(): [AdminConfig, (updater: (prev: AdminConfig) => AdminConfig) => void] {
  const [cfg, setCfg] = useState<AdminConfig>(loadAdminConfig);

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<AdminConfig>).detail;
      if (detail) setCfg(detail);
    }
    window.addEventListener("fc_admin_cfg_change", onUpdate);
    if (!_refreshed) {
      _refreshed = true;
      refreshAdminConfigFromServer();
    }
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
