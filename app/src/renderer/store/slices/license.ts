/**
 * The licence as main's gate reports it (D11): null until the first answer. Main decides; the
 * renderer only shows the Activate screen and About's licence card from this status.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { LicenseStatus } from "@shared/ipc";

export interface LicenseState {
  status: LicenseStatus | null;
}

/** Outside Electron (tests, a page opened in a browser) nothing is licensed or required. */
export const LICENSE_NOT_REQUIRED: LicenseStatus = {
  required: false,
  state: "active",
  reason: null,
  license: null,
  notSaved: false,
  configError: null,
};

const initialState: LicenseState = { status: null };

const licenseSlice = createSlice({
  name: "license",
  initialState,
  reducers: {
    licenseStatusReceived(state, action: PayloadAction<LicenseStatus>) {
      state.status = action.payload;
    },
  },
});

export const { licenseStatusReceived } = licenseSlice.actions;
export const licenseReducer = licenseSlice.reducer;
