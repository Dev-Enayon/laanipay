import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const ConfigContext = createContext({ emailVerificationEnabled: true, activationFeeKobo: 150000 });

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState({ emailVerificationEnabled: true, activationFeeKobo: 150000 });

  useEffect(() => {
    let active = true;
    api('/config', { method: 'GET' })
      .then((data) => {
        if (!active) return;
        setConfig({
          emailVerificationEnabled: data?.emailVerificationEnabled ?? true,
          activationFeeKobo: data?.activationFeeKobo ?? 150000,
        });
      })
      .catch(() => {
        // Default keeps verification enabled if config can't be fetched.
      });
    return () => {
      active = false;
    };
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}
