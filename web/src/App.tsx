import { useEffect } from 'react'
import { useStore } from './store'
import { AuthScreen } from './screens/AuthScreen'
import { ChatScreen } from './screens/ChatScreen'
import { Toasts } from './components/ui'

export function App() {
  const me = useStore((s) => s.me)
  const booting = useStore((s) => s.booting)
  const boot = useStore((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    const onExpired = () => {
      useStore.setState({
        me: null,
        groups: [],
        activeId: null,
        detail: null,
        messages: [],
        pane: 'list',
      })
      useStore.getState().toast('登录已过期，请重新登录', 'error')
    }
    window.addEventListener('shiyu:session-expired', onExpired)
    return () => window.removeEventListener('shiyu:session-expired', onExpired)
  }, [])

  if (booting) {
    return (
      <div className="auth-page">
        <div className="col" style={{ alignItems: 'center', gap: 12 }}>
          <span className="brand-mark" style={{ width: 34, height: 34, fontSize: 15 }}>
            拾
          </span>
          <span className="t12 faint">正在载入…</span>
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    )
  }

  return (
    <>
      <ChatScreen />
      <Toasts />
    </>
  )
}
