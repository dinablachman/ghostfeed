import { useState } from 'react'
import axios from 'axios'
import './App.css'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

function App() {
  const [username, setUsername] = useState('')
  const [tweets, setTweets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setTweets([])
    if (!username.trim()) return
    setLoading(true)
    try {
      const res = await axios.get(`/api/tweets/${username.replace(/^@/, '')}`)
      setTweets(res.data)
      if (res.data.length === 0) setError('No archived tweets found.')
    } catch (err) {
      setError('Failed to fetch tweets.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Wayback Twitter Viewer</h1>
      <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
        <input
          type="text"
          placeholder="@suspendeduser"
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={{ padding: 8, fontSize: 16, width: 240 }}
        />
        <button type="submit" style={{ marginLeft: 12, padding: '8px 16px', fontSize: 16 }} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      {error && <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tweets.map((tweet, i) => (
          <li key={i} style={{ marginBottom: 20, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
            <div style={{ marginBottom: 8 }}>{tweet.text}</div>
            <div style={{ color: '#888', fontSize: 14 }}>{formatDate(tweet.timestamp)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
