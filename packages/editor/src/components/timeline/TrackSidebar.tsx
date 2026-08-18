import {MEDIA_AUDIO_TRACK_ID, type AudioTrackId} from '@canvas-commons/core';
import clsx from 'clsx';
import {useEffect, useRef, useState} from 'preact/hooks';
import {useApplication} from '../../contexts';
import {usePlayerState, useStorage} from '../../hooks';
import {MouseButton} from '../../utils';
import {DragIndicator, VolumeOff, VolumeOn} from '../icons';
import {ChevronLeft} from '../icons/ChevronLeft';
import {ChevronRight} from '../icons/ChevronRight';
import {useAudioTracks} from './audioTracks';
import styles from './Timeline.module.scss';
import {
  DEFAULT_WAVE_HEIGHT,
  TRACK_ORDER_HEAD,
  TRACK_ORDER_TAIL,
  TimelineTrackId,
  projectLaneId,
  useTrackHeights,
  useTrackScrollTop,
  useWaveHeight,
} from './trackLayout';

const FIXED_TRACK_LABELS: Record<string, string> = {
  range: '',
  scene: 'Scenes',
  label: 'Labels',
  media: 'Media audio',
};

function labelFor(id: TimelineTrackId): string {
  return FIXED_TRACK_LABELS[id] ?? '';
}

function TrackResizeHandle({id, label}: {id: TimelineTrackId; label: string}) {
  const {height, setHeight} = useWaveHeight(id);
  const dragRef = useRef<{y: number; height: number} | null>(null);

  return (
    <div
      className={styles.trackResize}
      data-track-resize={id}
      title={`Resize ${label} (double-click to reset)`}
      onPointerDown={event => {
        if (event.button !== MouseButton.Left) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {y: event.clientY, height};
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const drag = dragRef.current;
        if (!drag) return;
        event.stopPropagation();
        setHeight(drag.height + (event.clientY - drag.y));
      }}
      onPointerUp={event => {
        if (event.button !== MouseButton.Left) return;
        event.stopPropagation();
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onDblClick={() => setHeight(DEFAULT_WAVE_HEIGHT)}
    />
  );
}

interface MixButtonsProps {
  trackId: AudioTrackId;
  name: string;
}

function MixButtons({trackId, name}: MixButtonsProps) {
  const {player} = useApplication();
  const state = usePlayerState();
  const mix = state.trackMix[trackId];
  const muted = (mix?.volume ?? 1) === 0;
  const solo = mix?.solo ?? false;

  return (
    <div className={styles.trackButtons}>
      <button
        type="button"
        title={muted ? `Unmute ${name}` : `Mute ${name}`}
        className={clsx(
          styles.trackButton,
          styles.trackIconButton,
          muted && styles.trackButtonActive,
        )}
        onClick={() => player.toggleTrackMuted(trackId)}
      >
        {muted ? <VolumeOff /> : <VolumeOn />}
      </button>
      <button
        type="button"
        title={solo ? `Unsolo ${name}` : `Solo ${name}`}
        className={clsx(styles.trackButton, solo && styles.trackButtonActive)}
        onClick={() => player.toggleTrackSolo(trackId)}
      >
        S
      </button>
    </div>
  );
}

interface FixedTrackHeaderProps {
  id: TimelineTrackId;
  name: string;
  height: number;
  trackId?: AudioTrackId;
  resizable?: boolean;
}

function FixedTrackHeader({
  id,
  name,
  height,
  trackId,
  resizable,
}: FixedTrackHeaderProps) {
  return (
    <div
      className={styles.trackHeader}
      data-track-header={id}
      style={{height: `${height}px`}}
    >
      <div className={styles.trackAccent} />
      <div className={styles.trackHeaderBody}>
        <div className={styles.trackHeaderTop}>
          <div className={styles.trackName} title={name}>
            {name}
          </div>
          {trackId && <MixButtons trackId={trackId} name={name} />}
        </div>
        {resizable && <TrackResizeHandle id={id} label={name} />}
      </div>
    </div>
  );
}

interface ProjectTrackHeaderProps {
  trackId: string;
  name: string;
  color: string;
  height: number;
  count: number;
}

const TRACK_DND_TYPE = 'application/x-audio-track';

function ProjectTrackHeader({
  trackId,
  name,
  color,
  count,
  height,
}: ProjectTrackHeaderProps) {
  const laneId = projectLaneId(trackId);
  const {renameTrack, recolorTrack, removeTrack, reorderTrack} =
    useAudioTracks();
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null);

  return (
    <div
      className={clsx(styles.trackHeader, dragOver && styles.trackDropTarget)}
      data-track-header={laneId}
      style={{height: `${height}px`}}
      onContextMenu={event => {
        event.preventDefault();
        setMenu({x: event.clientX, y: event.clientY});
      }}
      onDragOver={event => {
        if (event.dataTransfer?.types.includes(TRACK_DND_TYPE)) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => {
        const draggedId = event.dataTransfer?.getData(TRACK_DND_TYPE);
        setDragOver(false);
        if (draggedId) {
          event.preventDefault();
          reorderTrack(draggedId, trackId);
        }
      }}
    >
      <label className={styles.trackAccent} style={{backgroundColor: color}}>
        <input
          type="color"
          className={styles.trackColorInput}
          value={color}
          onInput={event =>
            recolorTrack(trackId, (event.target as HTMLInputElement).value)
          }
        />
      </label>
      <div
        className={styles.trackDragHandle}
        title="Drag to reorder"
        draggable
        onDragStart={event => {
          event.dataTransfer?.setData(TRACK_DND_TYPE, trackId);
          event.dataTransfer!.effectAllowed = 'move';
        }}
      >
        <DragIndicator />
      </div>
      <div className={styles.trackHeaderBody}>
        <div className={styles.trackHeaderTop}>
          {editing ? (
            <input
              className={styles.trackNameInput}
              value={name}
              autoFocus
              onBlur={() => setEditing(false)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === 'Escape') {
                  (event.target as HTMLInputElement).blur();
                }
              }}
              onInput={event =>
                renameTrack(trackId, (event.target as HTMLInputElement).value)
              }
            />
          ) : (
            <div
              className={styles.trackName}
              title="Double-click to rename"
              onDblClick={() => setEditing(true)}
            >
              {name}
            </div>
          )}
          <MixButtons trackId={trackId} name={name} />
        </div>
        <TrackResizeHandle id={laneId} label={name} />
      </div>
      {menu && (
        <TrackContextMenu
          x={menu.x}
          y={menu.y}
          canRemove={count > 1}
          onRemove={() => removeTrack(trackId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TrackContextMenuProps {
  x: number;
  y: number;
  canRemove: boolean;
  onRemove: () => void;
  onClose: () => void;
}

function TrackContextMenu({
  x,
  y,
  canRemove,
  onRemove,
  onClose,
}: TrackContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeIfOutside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('contextmenu', closeIfOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('contextmenu', closeIfOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={styles.trackContextMenu}
      style={{left: `${x}px`, top: `${y}px`}}
    >
      <button
        type="button"
        className={styles.trackContextItem}
        disabled={!canRemove}
        onClick={() => {
          onRemove();
          onClose();
        }}
      >
        Remove track
      </button>
    </div>
  );
}

export function TrackSidebar({
  onWheel,
}: {
  onWheel?: (event: WheelEvent) => void;
}) {
  const heights = useTrackHeights();
  const scrollTop = useTrackScrollTop();
  const {tracks, addTrack} = useAudioTracks();
  const [collapsed, setCollapsed] = useStorage(
    'timeline-sidebar-collapsed',
    false,
  );

  return (
    <div
      className={clsx(styles.sidebar, collapsed && styles.collapsed)}
      data-track-sidebar
      onWheel={onWheel}
    >
      <button
        type="button"
        className={styles.sidebarToggle}
        data-sidebar-toggle
        title={collapsed ? 'Show track sidebar' : 'Hide track sidebar'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight /> : <ChevronLeft />}
      </button>
      {!collapsed && (
        <div
          className={styles.sidebarRows}
          style={{transform: `translateY(${-scrollTop.value}px)`}}
        >
          {TRACK_ORDER_HEAD.map(id => {
            const height = heights[id];
            if (height === undefined) return null;
            if (id === 'range') {
              return (
                <div
                  key={id}
                  data-track-header={id}
                  style={{height: `${height}px`}}
                />
              );
            }
            return (
              <FixedTrackHeader
                key={id}
                id={id}
                name={labelFor(id)}
                height={height}
              />
            );
          })}

          {tracks.map(track => {
            const laneId = projectLaneId(track.id);
            const height = heights[laneId];
            if (height === undefined) return null;
            return (
              <ProjectTrackHeader
                key={track.id}
                trackId={track.id}
                name={track.name}
                color={track.color}
                height={height}
                count={tracks.length}
              />
            );
          })}

          <button
            type="button"
            className={styles.addTrackButton}
            title="Add audio track"
            onClick={addTrack}
          >
            + Add audio track
          </button>

          {TRACK_ORDER_TAIL.map(id => {
            const height = heights[id];
            if (height === undefined) return null;
            return (
              <FixedTrackHeader
                key={id}
                id={id}
                name={labelFor(id)}
                height={height}
                trackId={MEDIA_AUDIO_TRACK_ID}
                resizable
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
