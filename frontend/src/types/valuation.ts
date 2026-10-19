export type ProvenanceStatus = "sourced" | "derived" | "manual" | "missing" | "illustrative";

export type FieldProvenance = {
  status: ProvenanceStatus;
  source?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  filed?: string | null;
  form?: string | null;
  tag?: string | null;
  unit?: string | null;
  note?: string | null;
};

export type Peer = {
  name: string;
  enterprise_value: number;
  revenue: number;
  ebitda: number;
};

export type CompanyInput = {
  name: string;
  ticker?: string | null;
  company_type: "public" | "private";
  currency: string;
  base_year: number;
  revenue: number;
  ebitda: number;
  cash: number;
  debt: number;
  diluted_shares?: number | null;
  tax_rate: number;
  tax_methodology: "tax_on_positive_ebit_only" | "full_tax_shield";
  da_percent_revenue: number;
  capex_percent_revenue: number;
  nwc_percent_revenue: number;
  wacc: number;
  terminal_growth: number;
  growth_rates: number[];
  margin_targets: number[];
  peers: Peer[];
  sources: string[];
  provenance: Record<string, FieldProvenance>;
};

export type DraftCompany = Omit<CompanyInput,
  "base_year" | "revenue" | "ebitda" | "cash" | "debt" | "diluted_shares" |
  "tax_rate" | "da_percent_revenue" | "capex_percent_revenue" | "nwc_percent_revenue" |
  "wacc" | "terminal_growth" | "growth_rates" | "margin_targets" | "peers"
> & {
  base_year: number | "";
  revenue: number | "";
  ebitda: number | "";
  cash: number | "";
  debt: number | "";
  diluted_shares: number | "" | null;
  tax_rate: number | "";
  da_percent_revenue: number | "";
  capex_percent_revenue: number | "";
  nwc_percent_revenue: number | "";
  wacc: number | "";
  terminal_growth: number | "";
  growth_rates: Array<number | "">;
  margin_targets: Array<number | "">;
  peers: Array<{ name: string; enterprise_value: number | ""; revenue: number | ""; ebitda: number | "" }>;
};

export type Analysis = {
  company: CompanyInput;
  projections: Array<{
    year: number; revenue: number; ebitda: number; da: number; ebit: number; cash_taxes: number;
    nopat: number; capex: number; change_nwc: number; free_cash_flow: number; discount_factor: number; present_value: number;
  }>;
  peer_details: Array<{ name: string; ev_revenue: number; ev_ebitda: number }>;
  peer_multiples: { median_ev_revenue: number; median_ev_ebitda: number };
  dcf: {
    enterprise_value: number; equity_value: number; per_share: number | null; pv_forecast_fcf: number;
    terminal_value: number; pv_terminal_value: number; terminal_value_contribution: number | null;
  };
  comps: {
    revenue_method_enterprise_value: number; ebitda_method_enterprise_value: number;
    revenue_method_equity_value: number; ebitda_method_equity_value: number;
  };
  sensitivity: { wacc: number[]; terminal_growth: number[]; equity_values: number[][] };
  methodologies: Record<string, string>;
  risks: string[];
  review: { sourced: number; overridden: number; missing: number; illustrative: number };
};
