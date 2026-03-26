// 首頁（健康檢查 + 基本資訊）
export default function Home() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>一休官方 LINE Bot</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>Webhook endpoint: /api/webhook</p>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px' }}>
        <p style={{ color: '#166534', margin: 0 }}>✅ Bot is running</p>
      </div>
    </div>
  );
}
