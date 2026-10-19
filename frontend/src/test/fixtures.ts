import { btcUsdFixture } from '../data/btcUsdFixture'
import type { InstrumentPageData } from '../types/market'

export function getDemoInstrumentSync(): InstrumentPageData {
  return structuredClone(btcUsdFixture)
}
