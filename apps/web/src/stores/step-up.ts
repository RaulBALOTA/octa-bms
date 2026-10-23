import { create } from 'zustand';

export type StepUpMethod = 'totp' | 'password' | 'passkey';

interface StepUpState {
  open: boolean;
  method: StepUpMethod;
  methods: StepUpMethod[];
  resolve: ((ok: boolean) => void) | null;
  finish: (ok: boolean) => void;
}

/** Bridges API 403 STEP_UP_REQUIRED responses to the global StepUpDialog. */
export const useStepUpStore = create<StepUpState>()((set, get) => ({
  open: false,
  method: 'totp',
  methods: ['totp'],
  resolve: null,
  finish(ok) {
    get().resolve?.(ok);
    set({ open: false, resolve: null });
  },
}));

let pending: Promise<boolean> | null = null;

/** Opens the dialog (once, even for parallel requests) and resolves when the user finishes. */
export function requestStepUp(method: StepUpMethod, methods: StepUpMethod[] = [method]): Promise<boolean> {
  pending ??= new Promise<boolean>((resolve) => {
    useStepUpStore.setState({ open: true, method, methods, resolve: (ok) => { pending = null; resolve(ok); } });
  });
  return pending;
}
