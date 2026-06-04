import { useState, useEffect } from 'react';

const STORE_ID = "ST1008";
const API_BASE = "http://localhost:3000/stores";

export default function App() {
  const [metrics, setMetrics] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [isResetting, setIsResetting] = useState(false);

  // 1. Extracted fetchData so both the polling interval AND the reset button can trigger it
  const fetchData = async () => {
    try {
      const [metricsRes, funnelRes, anomaliesRes] = await Promise.all([
        fetch(`${API_BASE}/${STORE_ID}/metrics`),
        fetch(`${API_BASE}/${STORE_ID}/funnel`),
        fetch(`${API_BASE}/${STORE_ID}/anomalies`)
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (funnelRes.ok) setFunnel(await funnelRes.json());
      if (anomaliesRes.ok) {
        const anomData = await anomaliesRes.json();
        setAnomalies(anomData.anomalies || []);
      }
    } catch (error) {
      console.error("Dashboard cannot reach API:", error);
    }
  };

  // 2. The polling loop uses the extracted function
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData(); // Initial fetch
    const interval = setInterval(fetchData, 3000); // Poll every 3 seconds for LIVE effect
    return () => clearInterval(interval);
  }, []);

  // 3. The Reset Handler
  const handleReset = async () => {
    // Add a quick confirmation dialog so you don't accidentally wipe it!
    if (!window.confirm("Are you sure you want to wipe all live camera events? The offline POS data will remain safe.")) return;
    
    setIsResetting(true);
    try {
      const res = await fetch('http://localhost:3000/reset', { method: 'POST' });
      if (res.ok) {
        // Force an immediate refresh so the dashboard instantly drops to 0
        await fetchData(); 
      } else {
        alert("Reset failed. Did you add the /reset route to main.js?");
      }
    } catch (err) {
      console.error("Failed to reset:", err);
      alert("Could not reach the API to reset data.");
    }
    setIsResetting(false);
  };

  if (!metrics) return <div className="p-10 text-xl font-bold text-gray-600">📡 Connecting to Apex Intelligence Edge...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      
      {/* Updated Header with Flexbox to hold the Reset Button */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Apex Retail Intelligence</h1>
          <p className="text-gray-500">Live Telemetry • Store {STORE_ID} • Auto-updating every 3s</p>
        </div>
        
        {/* THE RESET BUTTON */}
        <button 
          onClick={handleReset}
          disabled={isResetting}
          className="bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200 px-4 py-2 rounded-lg font-bold shadow-sm transition-colors flex items-center gap-2"
        >
          {isResetting ? "⏳ Wiping Database..." : "🗑️ Reset Live Demo"}
        </button>
      </header>

      {anomalies.length > 0 && (
        <div className="mb-8 space-y-3">
          {anomalies.map((anom, idx) => (
            <div key={idx} className={`p-4 rounded-lg border-l-4 shadow-sm flex items-start justify-between ${
              anom.severity === 'CRITICAL' ? 'bg-red-50 border-red-500 text-red-900' : 
              anom.severity === 'WARN' ? 'bg-yellow-50 border-yellow-500 text-yellow-900' : 
              'bg-blue-50 border-blue-500 text-blue-900'
            }`}>
              <div>
                <h3 className="font-bold flex items-center gap-2">
                  <span className="uppercase text-xs tracking-wider px-2 py-1 rounded bg-white bg-opacity-50">{anom.severity}</span>
                  {anom.type.replace(/_/g, ' ')}
                </h3>
                <p className="mt-1 text-sm">{anom.description}</p>
                <p className="mt-2 text-xs font-semibold opacity-80">🤖 Recommended Action: {anom.suggested_action}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">Unique Walk-ins</p>
          <p className="text-4xl font-black text-gray-900 mt-2">{metrics.unique_visitors}</p>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">Live Conversion Rate</p>
          <p className="text-4xl font-black text-emerald-600 mt-2">{metrics.conversion_rate}%</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">Current Queue Depth</p>
          <p className="text-4xl font-black text-indigo-600 mt-2">{metrics.current_queue_depth}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-500">Queue Abandonment</p>
          <p className="text-4xl font-black text-rose-600 mt-2">{metrics.abandonment_rate}%</p>
        </div>
      </div>

      {funnel && (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Customer Journey Funnel</h2>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-center">
            
            <div className="flex-1 w-full p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold">{funnel.funnel_metrics.walk_ins}</p>
              <p className="text-sm text-gray-500 mt-1">Walk-ins</p>
            </div>
            
            <div className="text-gray-400 font-bold text-sm">
              -{funnel.drop_off_percentages.walk_in_to_engage}
            </div>

            <div className="flex-1 w-full p-4 bg-indigo-50 rounded-lg text-indigo-900">
              <p className="text-2xl font-bold">{funnel.funnel_metrics.engaged_in_zones}</p>
              <p className="text-sm opacity-80 mt-1">Engaged with Zones</p>
            </div>

            <div className="text-gray-400 font-bold text-sm">
              -{funnel.drop_off_percentages.engage_to_queue}
            </div>

            <div className="flex-1 w-full p-4 bg-purple-50 rounded-lg text-purple-900">
              <p className="text-2xl font-bold">{funnel.funnel_metrics.joined_billing_queue}</p>
              <p className="text-sm opacity-80 mt-1">Joined Queue</p>
            </div>

            <div className="text-gray-400 font-bold text-sm">
              -{funnel.drop_off_percentages.queue_to_purchase}
            </div>

            <div className="flex-1 w-full p-4 bg-emerald-50 rounded-lg text-emerald-900">
              <p className="text-2xl font-bold">{funnel.funnel_metrics.successful_purchases}</p>
              <p className="text-sm opacity-80 mt-1">Purchases</p>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}