// Sales report for a date range in Malaysia time (Asia/Kuala_Lumpur, UTC+8, no daylight saving).
// Definitions (also shown in the admin):
//  - An order counts on the day it was PAID (paid_at). Unpaid, cancelled and expired orders never count
//    as sales; they are reported separately.
//  - Gross sales = item subtotals; discounts and shipping as charged; total collected = what customers paid.
//  - Refunds count on the day they were recorded, whichever day the order was paid.
//  - Net sales = total collected − refunds in the range. Average order value = total collected ÷ orders.
//  - Top products: units and item revenue (before order-level discounts) from paid orders in the range.
//  - No conversion rate: the store does not record visits yet, so none is shown.
import {HttpError} from './auth.mjs';
import {hasColumn} from './schema.mjs';
export const TZ='Asia/Kuala_Lumpur';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(new Date());
const shift=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};

export async function salesReport(db,params=new URLSearchParams()){
 const to=params.get('to')||today(),from=params.get('from')||shift(to,-29);
 if(!DAY.test(from)||!DAY.test(to)||Number.isNaN(Date.parse(from))||Number.isNaN(Date.parse(to)))throw new HttpError(400,'Dates must be YYYY-MM-DD');
 if(from>to)throw new HttpError(400,'“From” must be on or before “To”');
 const days=Math.round((Date.parse(to)-Date.parse(from))/864e5)+1;if(days>366)throw new HttpError(400,'Choose a range of up to 366 days');
 // Range bounds as instants: local midnight of `from` to local midnight after `to`.
 const range=[`${from} 00:00:00`,`${shift(to,1)} 00:00:00`];
 const inRange=col=>`${col}>=($1::timestamp AT TIME ZONE '${TZ}') AND ${col}<($2::timestamp AT TIME ZONE '${TZ}')`;
 const disc=await hasColumn(db,'orders','discount_minor')?'discount_minor':'0';
 const s=(await db.query(`SELECT count(*)::int AS orders,coalesce(sum(subtotal_minor),0)::bigint AS gross,coalesce(sum(${disc}),0)::bigint AS discounts,coalesce(sum(shipping_minor),0)::bigint AS shipping,coalesce(sum(total_minor),0)::bigint AS collected
  FROM orders WHERE status='paid' AND ${inRange('paid_at')}`,range)).rows[0];
 const refunds=(await db.query(`SELECT count(*)::int AS n,coalesce(sum(amount_minor),0)::bigint AS amount FROM refunds WHERE ${inRange('created_at')}`,range)).rows[0];
 const lost=(await db.query(`SELECT count(*) FILTER (WHERE status='cancelled')::int AS cancelled,count(*) FILTER (WHERE status='expired')::int AS expired FROM orders WHERE status IN ('cancelled','expired') AND ${inRange('cancelled_at')}`,range)).rows[0];
 const daily=(await db.query(`SELECT to_char((paid_at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS day,count(*)::int AS orders,sum(total_minor)::bigint AS collected FROM orders WHERE status='paid' AND ${inRange('paid_at')} GROUP BY 1 ORDER BY 1`,range)).rows;
 const byDay=new Map(daily.map(d=>[d.day,d]));const series=[];for(let i=0;i<days&&i<366;i++){const day=shift(from,i),d=byDay.get(day);series.push({day,orders:d?.orders??0,collected_minor:Number(d?.collected??0)});}
 const top=(await db.query(`SELECT l.product_id::text AS product_id,min(l.title) AS title,sum(l.quantity)::int AS units,sum(l.line_total_minor)::bigint AS revenue
  FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status='paid' AND ${inRange('o.paid_at')} GROUP BY l.product_id ORDER BY units DESC,revenue DESC LIMIT 10`,range)).rows.map(r=>({...r,revenue_minor:Number(r.revenue)}));
 const stock=(await db.query(`SELECT count(*) FILTER (WHERE v.inventory>5)::int AS in_stock,count(*) FILTER (WHERE v.inventory BETWEEN 1 AND 5)::int AS low,count(*) FILTER (WHERE v.inventory=0)::int AS out
  FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.active AND p.status<>'archived'`)).rows[0];
 const collected=Number(s.collected);
 return {from,to,timezone:TZ,days,
  summary:{orders:s.orders,gross_sales_minor:Number(s.gross),discounts_minor:Number(s.discounts),shipping_minor:Number(s.shipping),collected_minor:collected,refunds_minor:Number(refunds.amount),refund_count:refunds.n,net_sales_minor:collected-Number(refunds.amount),average_order_minor:s.orders?Math.round(collected/s.orders):0,cancelled_orders:lost.cancelled,expired_orders:lost.expired},
  series,top_products:top.map(({revenue,...r})=>r),inventory:{variants_in_stock:stock.in_stock,variants_low:stock.low,variants_out:stock.out},
  conversion:null};
}
