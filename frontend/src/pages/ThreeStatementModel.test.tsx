import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ThreeStatementModel } from './ThreeStatementModel'

afterEach(()=>vi.unstubAllGlobals())

it('shows source conflicts and never presents an incomplete model as frozen', async()=>{
  const user=userEvent.setup()
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/normalize')?{
    currency:'USD',history:[{period_end:'2024-12-31'}],missing:[{field:'cash'}],
    conflicts:[{period:'2024-12-31',field:'revenue'}]
  }:[]})))
  render(<ThreeStatementModel symbol="AAPL" statements={[{id:'s1',period_end:'2024-12-31',source:'Reviewed filing'}]}/> )
  await user.click(screen.getByRole('checkbox',{name:/Reviewed filing/}))
  await user.click(screen.getByRole('button',{name:'Normalize selected years'}))
  expect(await screen.findByText(/conflicting source mapping/)).toBeInTheDocument()
  expect(screen.getByLabelText('Integrated case inputs')).toHaveValue('')
  expect(screen.getByRole('button',{name:'Freeze case'})).toBeDisabled()
})
