import { createContext, useContext } from 'react';

export type ConnectivityState = {
  /** True when Supabase is reachable */
  online: boolean;
  /** True while we're actively checking */
  checking: boolean;
  /** Epoch ms of last successful Supabase response, or null if never */
  lastOnline: number | null;
};

export const ConnectivityContext = createContext<ConnectivityState>({
  online: true,
  checking: false,
  lastOnline: null,
});

export function useConnectivity(): ConnectivityState {
  return useContext(ConnectivityContext);
}
