import { useEffect, useState } from 'react'
import type { Participant } from '../../shared/types'
import type { WatcherInfo } from './publisher'
import type { Session } from './session'

/** Who's in the room and what they're doing, for views outside the room itself (the rooms sidebar). */
export interface RoomPeople {
  participants: Participant[]
  /** Profile pictures by participant id. */
  avatars: ReadonlyMap<string, string>
  /** Latest preview of each live stream, by streamer id. */
  snapshots: ReadonlyMap<string, string>
  /** Streams we watch. */
  watching: ReadonlySet<string>
  /** People watching our stream, with what they report about it. */
  myWatchers: ReadonlyMap<string, WatcherInfo>
}

export function useRoomPeople(session: Session): RoomPeople {
  const { client, publisher, watches } = session
  const [participants, setParticipants] = useState(client.participants)
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map(client.avatars))
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, string>>(new Map(client.snapshots))
  const [watching, setWatching] = useState<ReadonlySet<string>>(new Set(watches.all.keys()))
  const [myWatchers, setMyWatchers] = useState<ReadonlyMap<string, WatcherInfo>>(new Map(publisher.watchers))

  useEffect(() => {
    const offs = [
      client.on('participants', setParticipants),
      client.on('avatars', (m) => setAvatars(new Map(m))),
      client.on('snapshots', (m) => setSnapshots(new Map(m))),
      watches.on('changed', (m) => setWatching(new Set(m.keys()))),
      publisher.on('watchers', (m) => setMyWatchers(new Map(m)))
    ]
    // Whatever arrived between the first render and now.
    setParticipants(client.participants)
    setAvatars(new Map(client.avatars))
    setSnapshots(new Map(client.snapshots))
    return () => offs.forEach((off) => off())
  }, [client, publisher, watches])

  return { participants, avatars, snapshots, watching, myWatchers }
}
