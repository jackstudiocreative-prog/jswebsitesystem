// Transactional email outbox. Messages are queued in the same transaction as the order change, so an
// email exists exactly when the change committed. Plain text only (no customer data rendered as HTML).
// Sending is not enabled yet: when an email provider is chosen, a sender reads 'pending' rows.
const money=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(n/100);
function render(kind,order,lines,extra={}){
 const items=lines.map(l=>`- ${l.quantity} × ${l.title}${l.variant_title?' ('+l.variant_title+')':''}  ${money(l.line_total_minor)}`).join('\n');
 const totals=`Subtotal: ${money(order.subtotal_minor)}\nShipping: ${order.shipping_minor?money(order.shipping_minor):'Free'}\nTotal: ${money(order.total_minor)}`;
 const address=[order.customer_name,order.address_line1,order.address_line2,`${order.postcode} ${order.city}`,`${order.state}, Malaysia`].filter(Boolean).join('\n');
 const sign='\n\nThank you for choosing Jack Studio.\nFrom everyday essentials to every journey.';
 if(kind==='order_paid')return {subject:`Your Jack Studio order ${order.number} is confirmed`,body:`Hi ${order.customer_name},\n\nWe have received your payment for order ${order.number}. We are preparing your items.\n\n${items}\n\n${totals}\n\nDelivering to:\n${address}${sign}`};
 if(kind==='order_fulfilled')return {subject:`Your Jack Studio order ${order.number} is on its way`,body:`Hi ${order.customer_name},\n\nYour order ${order.number} has been shipped.${order.tracking_number?`\nTracking number: ${order.tracking_number}`:''}\n\n${items}\n\nDelivering to:\n${address}${sign}`};
 return {subject:`Refund for your Jack Studio order ${order.number}`,body:`Hi ${order.customer_name},\n\nWe have refunded ${money(extra.amount_minor)} for order ${order.number} to your original payment method. Banks may take several working days to show it.\n\n${totals}\nRefunded so far: ${money(order.refunded_minor)}${sign}`};
}
export async function queueEmail(db,orderId,kind,extra){
 const order=(await db.query('SELECT * FROM orders WHERE id=$1',[orderId])).rows[0];
 const lines=(await db.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[orderId])).rows;
 const {subject,body}=render(kind,order,lines,extra);
 await db.query('INSERT INTO email_outbox(order_id,kind,recipient,subject,body) VALUES ($1,$2,$3,$4,$5)',[orderId,kind,order.email,subject,body.slice(0,20000)]);
}
export {render as renderEmail};
