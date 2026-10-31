import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Camera,
  Sparkles,
  RotateCcw,
  Send,
  Mic,
  Globe,
  Layers,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import {
  DEFAULT_AVATAR_3D,
  DEFAULT_AVATAR_GLB_URL,
  parseReadyPlayerMeMessage,
  computeExpressionMorphWeights,
  type Avatar3DConfig,
} from '../utils/socialAndGroups';

interface Avatar3DStudioProps {
  config: Avatar3DConfig;
  darkMode: boolean;
  onChangeConfig: (next: Avatar3DConfig) => void;
  onCaptureAvatarDataUrl: (dataUrl: string, config: Avatar3DConfig) => void;
  onSend3DStickerToChat?: (dataUrl: string, caption: string) => void;
}

const SKIN_TONES = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3818'];
const HAIR_COLORS = ['#0ea5e9', '#1e293b', '#f43f5e', '#a855f7', '#eab308', '#10b981'];
const OUTFIT_COLORS = ['#0284c7', '#059669', '#7c3aed', '#e11d48', '#d97706', '#334155'];
const EYE_COLORS = ['#38bdf8', '#10b981', '#a855f7', '#f59e0b', '#f43f5e', '#64748b'];
const AURA_COLORS = ['#0f172a', '#090d16', '#1e1b4b', '#064e3b', '#3b0764', '#172554'];

const PRESET_GLB_MODELS = [
  {
    id: 'rpm-cyber',
    label: 'Ready Player Me Rig (.GLB)',
    url: '/models/readyplayer.me.glb',
  },
  {
    id: 'stylized-humanoid',
    label: 'Stylized Humanoid (.GLB)',
    url: '/models/Michelle.glb',
  },
] as const;

interface RigBoneRestMap {
  [boneName: string]: THREE.Quaternion;
}

export const Avatar3DStudio: React.FC<Avatar3DStudioProps> = ({
  config = DEFAULT_AVATAR_3D,
  darkMode,
  onChangeConfig,
  onCaptureAvatarDataUrl,
  onSend3DStickerToChat,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const rpmIframeRef = useRef<HTMLIFrameElement | null>(null);
  const configRef = useRef<Avatar3DConfig>({ ...DEFAULT_AVATAR_3D, ...config });
  const requestRenderRef = useRef<(() => void) | null>(null);
  const loadGlbModelRef = useRef<((url: string) => void) | null>(null);
  const captureSnapshotRef = useRef<(() => string) | null>(null);

  const targetRotYRef = useRef<number>(0.12);
  const isDraggingRef = useRef<boolean>(false);
  const lastXRef = useRef<number>(0);
  const voiceEnergyRef = useRef<number>(0);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [modelLoadedName, setModelLoadedName] = useState<string>('Ready Player Me Wolf3D Rig');
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  const [isVoiceSimulating, setIsVoiceSimulating] = useState<boolean>(false);
  const [customGlbInput, setCustomGlbInput] = useState<string>(
    config.avatarGlbUrl || DEFAULT_AVATAR_GLB_URL
  );

  const activeStudioMode = config.studioMode || 'three-gltf';
  const activeFraming = config.cameraFraming || 'bust';
  const activeBeard = config.beardStyle || 'sculpted';
  const activeGlbUrl = config.avatarGlbUrl || DEFAULT_AVATAR_GLB_URL;

  // Listen for Ready Player Me Web Creator postMessage events (Option 1)
  useEffect(() => {
    const handleRpmWindowMessage = (event: MessageEvent) => {
      const parsed = parseReadyPlayerMeMessage(event.data);
      if (parsed.type === 'frame-ready') {
        rpmIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            target: 'readyplayerme',
            type: 'subscribe',
            eventName: 'v1.**',
          }),
          '*'
        );
      } else if (parsed.type === 'avatar-exported' && parsed.glbUrl) {
        const exportedUrl = parsed.glbUrl;
        setCustomGlbInput(exportedUrl);
        const nextCfg: Avatar3DConfig = {
          ...configRef.current,
          avatarGlbUrl: exportedUrl,
          studioMode: 'three-gltf',
        };
        configRef.current = nextCfg;
        onChangeConfig(nextCfg);
        loadGlbModelRef.current?.(exportedUrl);
        setStatusMessage('Ready Player Me .GLB avatar imported and bound to 3D skeleton!');
        setTimeout(() => setStatusMessage(null), 3500);
      }
    };

    window.addEventListener('message', handleRpmWindowMessage);
    return () => window.removeEventListener('message', handleRpmWindowMessage);
  }, [onChangeConfig]);

  // Keep configRef synced and trigger live GLTF material/morph/bone updates
  useEffect(() => {
    const prevUrl = configRef.current.avatarGlbUrl || DEFAULT_AVATAR_GLB_URL;
    const nextUrl = config.avatarGlbUrl || DEFAULT_AVATAR_GLB_URL;
    configRef.current = { ...DEFAULT_AVATAR_3D, ...config };
    if (prevUrl !== nextUrl && loadGlbModelRef.current) {
      loadGlbModelRef.current(nextUrl);
    } else if (requestRenderRef.current) {
      requestRenderRef.current();
    }
  }, [config]);

  // Optional Voice Lip-Sync simulation driver for testing mouthOpen / mouthSmile morph targets
  useEffect(() => {
    if (!isVoiceSimulating) {
      voiceEnergyRef.current = 0;
      requestRenderRef.current?.();
      return;
    }
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      voiceEnergyRef.current = 0.25 + 0.7 * Math.abs(Math.sin(step * 0.65));
      requestRenderRef.current?.();
    }, 90);
    return () => {
      clearInterval(timer);
      voiceEnergyRef.current = 0;
    };
  }, [isVoiceSimulating]);

  // Core Three.js + GLTFLoader Rigged Humanoid Studio (Option 2 + Option 1 Preview)
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 300;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(configRef.current.bgAura || '#0f172a');

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 30);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Soft Studio Lighting (HemisphereLight + Key/Fill/Rim DirectionalLights)
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.05);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
    keyLight.position.set(1.8, 2.6, 2.4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.95);
    fillLight.position.set(-1.8, 1.9, 1.8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
    rimLight.position.set(0, 2.3, -2.0);
    scene.add(rimLight);

    // Subtle Studio Pedestal Ring under full-body feet
    const ringGeo = new THREE.RingGeometry(0.32, 0.36, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const studioRing = new THREE.Mesh(ringGeo, ringMat);
    studioRing.rotation.x = -Math.PI / 2;
    studioRing.position.y = 0.01;
    scene.add(studioRing);

    const avatarRoot = new THREE.Group();
    scene.add(avatarRoot);

    let loadedModelRoot: THREE.Object3D | null = null;
    let headBoneRef: THREE.Object3D | null = null;
    let neckBoneRef: THREE.Object3D | null = null;
    let leftEyeBoneRef: THREE.Object3D | null = null;
    let rightEyeBoneRef: THREE.Object3D | null = null;
    let rightArmBoneRef: THREE.Object3D | null = null;
    let rightForeArmBoneRef: THREE.Object3D | null = null;
    const boneRestQuats: RigBoneRestMap = {};
    const headAccessoryGroup = new THREE.Group();
    headAccessoryGroup.name = 'CipherLink_HeadAttachment';
    // Compensate for the Ready Player Me Head bone's rest pitch (-0.162 rad) so accessories sit level
    headAccessoryGroup.rotation.set(0.162, 0, 0);

    // Build 3D AR Lens & Headgear directly on the GLTF Head bone
    const rebuildHeadBoneAttachments = (cfg: Avatar3DConfig) => {
      while (headAccessoryGroup.children.length > 0) {
        const child = headAccessoryGroup.children[0];
        headAccessoryGroup.remove(child);
      }

      // 3D AR Lens & Headgear attached to Head bone (Eyes are at [±0.030, 0.088, 0.082])
      if (cfg.accessory === 'cyber-visor') {
        const visorGroup = new THREE.Group();
        const shieldMat = new THREE.MeshPhysicalMaterial({
          color: 0x0ea5e9,
          emissive: new THREE.Color(0x0284c7),
          emissiveIntensity: 0.45,
          metalness: 0.85,
          roughness: 0.12,
          clearcoat: 1.0,
          transparent: true,
          opacity: 0.88,
          side: THREE.DoubleSide,
        });
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          metalness: 0.9,
          roughness: 0.2,
          side: THREE.DoubleSide,
        });
        const neonLineMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
        });

        // Curved wrap-around visor lens aligned cleanly in front of the nose bridge
        const visorCurve = new THREE.CylinderGeometry(
          0.098,
          0.096,
          0.03,
          40,
          1,
          true,
          -Math.PI * 0.33,
          Math.PI * 0.66
        );
        const visorMesh = new THREE.Mesh(visorCurve, shieldMat);
        visorMesh.position.set(0, 0.08, 0.034);
        visorGroup.add(visorMesh);

        // Top metallic brow bar
        const browBar = new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.1,
            0.1,
            0.005,
            40,
            1,
            true,
            -Math.PI * 0.34,
            Math.PI * 0.68
          ),
          frameMat
        );
        browBar.position.set(0, 0.096, 0.035);
        visorGroup.add(browBar);

        // Glowing HUD laser scanline across visor
        const hudLine = new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.099,
            0.099,
            0.0025,
            40,
            1,
            true,
            -Math.PI * 0.29,
            Math.PI * 0.58
          ),
          neonLineMat
        );
        hudLine.position.set(0, 0.08, 0.035);
        visorGroup.add(hudLine);

        headAccessoryGroup.add(visorGroup);
      } else if (cfg.accessory === 'aviator-shades') {
        const shadesGroup = new THREE.Group();
        const goldRimMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          metalness: 0.95,
          roughness: 0.15,
        });
        const darkLensMat = new THREE.MeshPhysicalMaterial({
          color: 0x020617,
          metalness: 0.4,
          roughness: 0.08,
          clearcoat: 1.0,
        });

        [-0.032, 0.032].forEach((xPos) => {
          const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.024, 0.022, 0.005, 24),
            darkLensMat
          );
          lens.rotation.x = Math.PI / 2;
          lens.position.set(xPos, 0.072, 0.102);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.002, 12, 28), goldRimMat);
          rim.position.set(xPos, 0.072, 0.104);
          shadesGroup.add(lens, rim);
        });

        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0025, 0.0025), goldRimMat);
        bridge.position.set(0, 0.079, 0.104);
        shadesGroup.add(bridge);

        headAccessoryGroup.add(shadesGroup);
      } else if (cfg.accessory === 'gold-crown') {
        const crownGroup = new THREE.Group();
        const goldMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          metalness: 0.92,
          roughness: 0.16,
        });
        const gemMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: new THREE.Color(0x0284c7),
          emissiveIntensity: 0.6,
          roughness: 0.1,
        });

        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.076, 0.07, 0.034, 28),
          goldMat
        );
        band.position.set(0, 0.195, 0.005);
        crownGroup.add(band);

        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const peak = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.032, 12), goldMat);
          peak.position.set(Math.cos(a) * 0.07, 0.224, Math.sin(a) * 0.07 + 0.005);
          const gem = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 12), gemMat);
          gem.position.set(Math.cos(a) * 0.074, 0.195, Math.sin(a) * 0.074 + 0.005);
          crownGroup.add(peak, gem);
        }

        headAccessoryGroup.add(crownGroup);
      } else if (cfg.accessory === 'studio-headphones') {
        const headsetGroup = new THREE.Group();
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          metalness: 0.75,
          roughness: 0.25,
        });
        const accentMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(cfg.outfitColor || '#0284c7'),
          emissive: new THREE.Color(cfg.outfitColor || '#0284c7'),
          emissiveIntensity: 0.35,
          metalness: 0.8,
          roughness: 0.2,
        });

        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(0.105, 0.009, 14, 36, Math.PI),
          frameMat
        );
        arc.position.set(0, 0.088, -0.005);
        headsetGroup.add(arc);

        [-0.1, 0.1].forEach((xPos) => {
          const cup = new THREE.Mesh(
            new THREE.CylinderGeometry(0.034, 0.034, 0.024, 24),
            frameMat
          );
          cup.rotation.z = Math.PI / 2;
          cup.position.set(xPos, 0.068, -0.005);

          const neonRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.03, 0.0028, 12, 24),
            accentMat
          );
          neonRing.rotation.y = Math.PI / 2;
          neonRing.position.set(xPos + (xPos > 0 ? 0.013 : -0.013), 0.068, -0.005);
          headsetGroup.add(cup, neonRing);
        });

        headAccessoryGroup.add(headsetGroup);
      }
    };

    // Apply skin tone, hair tone, outfit color, morph targets, and bone poses to the loaded GLTF model
    const syncModelPropertiesWithConfig = () => {
      const cfg = configRef.current;
      scene.background = new THREE.Color(cfg.bgAura || '#0f172a');

      // Update Camera Framing (Bust / Waist / Full-Body)
      const framing = cfg.cameraFraming || 'bust';
      if (framing === 'full') {
        camera.position.set(0, 1.05, 2.65);
        camera.lookAt(0, 0.96, 0);
      } else if (framing === 'waist') {
        camera.position.set(0, 1.38, 1.32);
        camera.lookAt(0, 1.34, 0);
      } else {
        // Portrait Bust Close-up (default)
        camera.position.set(0, 1.68, 0.76);
        camera.lookAt(0, 1.65, 0);
      }

      if (!loadedModelRoot) return;

      const morphWeights = computeExpressionMorphWeights(cfg.expression, voiceEnergyRef.current);
      const skinColor = new THREE.Color(cfg.skinTone);
      const hairColor = new THREE.Color(cfg.hairColor);
      const outfitColor = new THREE.Color(cfg.outfitColor);
      const eyeColor = new THREE.Color(cfg.eyeColor || '#38bdf8');

      loadedModelRoot.traverse((obj) => {
        const mesh = obj as THREE.Mesh & {
          morphTargetDictionary?: Record<string, number>;
          morphTargetInfluences?: number[];
        };
        if (!mesh.isMesh) return;

        // 1. Toggle Headwear / Beard visibility & scale based on user customization (using native GLTF meshes!)
        if (mesh.name === 'Wolf3D_Beard') {
          mesh.visible = (cfg.beardStyle || 'sculpted') === 'sculpted';
        }
        if (mesh.name === 'Wolf3D_Headwear' || mesh.name === 'Mesh') {
          mesh.visible = cfg.hairStyle !== 'minimal-dome' && cfg.accessory !== 'gold-crown';
        }

        // 2. Apply Snapchat 3D Expression & Voice Lip-Sync morphTargetInfluences
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          const dict = mesh.morphTargetDictionary;
          const inf = mesh.morphTargetInfluences;

          const setMorph = (name: string, val: number) => {
            const idx = dict[name];
            if (idx !== undefined && idx < inf.length) {
              inf[idx] = val;
            }
          };

          setMorph('mouthSmile', morphWeights.mouthSmile);
          setMorph('mouthSmileLeft', morphWeights.mouthSmileLeft);
          setMorph('mouthSmileRight', morphWeights.mouthSmileRight);
          setMorph('mouthOpen', morphWeights.mouthOpen);
          setMorph('jawOpen', morphWeights.jawOpen);
          setMorph('eyeBlinkLeft', morphWeights.eyeBlinkLeft);
          setMorph('eyeBlinkRight', morphWeights.eyeBlinkRight);
          setMorph('browInnerUp', morphWeights.browInnerUp);
        }

        // 3. Tint Wolf3D PBR Materials (Skin, Hair/Beard/Headwear, Outfit, Eyes)
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (!stdMat || !stdMat.color) return;
          const matName = (stdMat.name || '').toLowerCase();

          if (
            matName.includes('skin') ||
            matName.includes('body') ||
            matName.includes('head') && !matName.includes('headwear')
          ) {
            // Blend skin tint smoothly while preserving PBR normal/albedo maps
            stdMat.color.copy(skinColor).lerp(new THREE.Color('#ffffff'), 0.28);
            stdMat.emissive.copy(skinColor).multiplyScalar(0.08);
            stdMat.roughness = 0.62;
            stdMat.metalness = 0.04;
          } else if (
            matName.includes('hair') ||
            matName.includes('beard') ||
            matName.includes('headwear')
          ) {
            stdMat.color.copy(hairColor);
            stdMat.emissive.copy(hairColor).multiplyScalar(0.14);
            stdMat.roughness = 0.38;
            stdMat.metalness = 0.18;
          } else if (matName.includes('outfit_top') || matName.includes('ch03_body')) {
            stdMat.color.copy(outfitColor).lerp(new THREE.Color('#ffffff'), 0.22);
            stdMat.emissive.copy(outfitColor).multiplyScalar(0.12);
            stdMat.roughness = 0.52;
            stdMat.metalness = 0.15;
          } else if (matName.includes('eye')) {
            stdMat.color.copy(eyeColor).lerp(new THREE.Color('#ffffff'), 0.45);
            stdMat.emissive.copy(eyeColor).multiplyScalar(0.18);
          }
        });
      });

      // 4. Apply Skeletal Pose to Head, Neck, Eyes, and Arms
      if (headBoneRef && boneRestQuats['Head']) {
        const poseEuler = new THREE.Euler(
          morphWeights.headPitch,
          morphWeights.headYaw,
          morphWeights.headRoll,
          'XYZ'
        );
        const offsetQuat = new THREE.Quaternion().setFromEuler(poseEuler);
        headBoneRef.quaternion.copy(boneRestQuats['Head']).multiply(offsetQuat);
      }

      if (leftEyeBoneRef) {
        leftEyeBoneRef.scale.set(1, morphWeights.leftEyeScaleY, 1);
      }
      if (rightEyeBoneRef) {
        rightEyeBoneRef.scale.set(1, 1, 1);
      }

      if (rightArmBoneRef && boneRestQuats['RightArm']) {
        const armEuler = new THREE.Euler(
          -morphWeights.rightArmRaise * 0.55,
          0,
          -morphWeights.rightArmRaise * 0.4,
          'XYZ'
        );
        rightArmBoneRef.quaternion
          .copy(boneRestQuats['RightArm'])
          .multiply(new THREE.Quaternion().setFromEuler(armEuler));
      }

      if (rightForeArmBoneRef && boneRestQuats['RightForeArm']) {
        const foreArmEuler = new THREE.Euler(
          -morphWeights.rightArmRaise * 0.75,
          0,
          -morphWeights.rightArmRaise * 0.35,
          'XYZ'
        );
        rightForeArmBoneRef.quaternion
          .copy(boneRestQuats['RightForeArm'])
          .multiply(new THREE.Quaternion().setFromEuler(foreArmEuler));
      }

      rebuildHeadBoneAttachments(cfg);
    };

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        syncModelPropertiesWithConfig();
        avatarRoot.rotation.y = targetRotYRef.current;
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;
    captureSnapshotRef.current = () => {
      syncModelPropertiesWithConfig();
      avatarRoot.rotation.y = targetRotYRef.current;
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    };

    const gltfLoader = new GLTFLoader();
    const loadGlbModel = (url: string) => {
      setIsLoadingModel(true);
      gltfLoader.load(
        url,
        (gltf) => {
          while (avatarRoot.children.length > 0) {
            avatarRoot.remove(avatarRoot.children[0]);
          }
          loadedModelRoot = gltf.scene;
          headBoneRef = null;
          neckBoneRef = null;
          leftEyeBoneRef = null;
          rightEyeBoneRef = null;
          rightArmBoneRef = null;
          rightForeArmBoneRef = null;

          loadedModelRoot.traverse((node) => {
            const name = node.name || '';
            if (name === 'Head' || name === 'mixamorig:Head') {
              headBoneRef = node;
              boneRestQuats['Head'] = node.quaternion.clone();
            } else if (name === 'Neck' || name === 'mixamorig:Neck') {
              neckBoneRef = node;
              boneRestQuats['Neck'] = node.quaternion.clone();
            } else if (name === 'LeftEye') {
              leftEyeBoneRef = node;
            } else if (name === 'RightEye') {
              rightEyeBoneRef = node;
            } else if (name === 'RightArm' || name === 'mixamorig:RightArm') {
              rightArmBoneRef = node;
              boneRestQuats['RightArm'] = node.quaternion.clone();
            } else if (name === 'RightForeArm' || name === 'mixamorig:RightForeArm') {
              rightForeArmBoneRef = node;
              boneRestQuats['RightForeArm'] = node.quaternion.clone();
            }
          });

          if (headBoneRef) {
            (headBoneRef as THREE.Object3D).add(headAccessoryGroup);
          } else if (neckBoneRef) {
            (neckBoneRef as THREE.Object3D).add(headAccessoryGroup);
          } else {
            loadedModelRoot.add(headAccessoryGroup);
          }

          avatarRoot.add(loadedModelRoot);
          setIsLoadingModel(false);
          setModelLoadedName(
            url.includes('Michelle')
              ? 'Stylized Full-Body Rig (.GLB)'
              : url.startsWith('http')
              ? 'Ready Player Me Custom (.GLB)'
              : 'Ready Player Me Wolf3D Rig (.GLB)'
          );
          requestRender();
        },
        undefined,
        () => {
          // Fallback to default local Ready Player Me .glb if custom URL fails
          if (url !== DEFAULT_AVATAR_GLB_URL) {
            loadGlbModel(DEFAULT_AVATAR_GLB_URL);
          } else {
            setIsLoadingModel(false);
          }
        }
      );
    };

    loadGlbModelRef.current = loadGlbModel;
    loadGlbModel(configRef.current.avatarGlbUrl || DEFAULT_AVATAR_GLB_URL);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      renderer.dispose();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    targetRotYRef.current += dx * 0.015;
    requestRenderRef.current?.();
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleApplyToProfile = () => {
    const snap = captureSnapshotRef.current?.();
    if (snap) {
      onCaptureAvatarDataUrl(snap, config);
      setStatusMessage('Rigged 3D GLTF Avatar rendered and applied to your CipherLink profile!');
      setTimeout(() => setStatusMessage(null), 2800);
    }
  };

  const handleSendSticker = () => {
    const snap = captureSnapshotRef.current?.();
    if (snap && onSend3DStickerToChat) {
      onSend3DStickerToChat(snap, `3D Avatar Pose (${config.expression})`);
    }
  };

  const handleLoadCustomGlb = () => {
    const trimmed = customGlbInput.trim();
    if (!trimmed) return;
    onChangeConfig({
      ...config,
      avatarGlbUrl: trimmed,
      studioMode: 'three-gltf',
    });
    loadGlbModelRef.current?.(trimmed);
    setStatusMessage(`Loaded 3D GLTF rig from ${trimmed}`);
    setTimeout(() => setStatusMessage(null), 2500);
  };

  return (
    <div
      className={`rounded-xl border p-4 space-y-4 ${
        darkMode
          ? 'bg-slate-950/90 border-slate-800 text-slate-100'
          : 'bg-slate-50 border-slate-200 text-slate-900'
      }`}
    >
      {/* Top Studio Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Interactive 3D Bitmoji & Ready Player Me GLTF Avatar Studio</span>
          </h4>
          <p className="text-[11px] text-slate-400">
            Rigged Wolf3D humanoid (.GLB) · Facial blendshapes (`morphTargetInfluences`) · Head-bone AR lenses
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Switch between Live 3D GLTF Rig & Embedded Ready Player Me Web Creator */}
          <button
            type="button"
            onClick={() =>
              onChangeConfig({
                ...config,
                studioMode: activeStudioMode === 'rpm-creator' ? 'three-gltf' : 'rpm-creator',
              })
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeStudioMode === 'rpm-creator'
                ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                : 'border-slate-700 hover:bg-slate-800 text-slate-300'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {activeStudioMode === 'rpm-creator'
                ? 'Back to 3D Rig Viewport'
                : 'Ready Player Me Studio'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsVoiceSimulating((v) => !v)}
            aria-label="Test Voice Lip-Sync Morph Targets"
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
              isVoiceSimulating
                ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                : 'border-slate-700 hover:bg-slate-800 text-slate-300'
            }`}
          >
            <Mic className="w-3 h-3" />
            <span>{isVoiceSimulating ? 'Stop Lip-Sync' : 'Lip-Sync Test'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              targetRotYRef.current = 0;
              requestRenderRef.current?.();
            }}
            aria-label="Reset 3D Avatar Rotation"
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs font-medium flex items-center gap-1 hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Center</span>
          </button>

          <button
            type="button"
            onClick={handleApplyToProfile}
            className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Apply 3D Avatar</span>
          </button>

          {onSend3DStickerToChat && (
            <button
              type="button"
              onClick={handleSendSticker}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send 3D Pose to Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Embedded Ready Player Me Web Creator Modal View (Option 1) */}
      {activeStudioMode === 'rpm-creator' && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-sky-400 font-semibold">
              <Globe className="w-4 h-4" />
              <span>
                Embedded Ready Player Me Avatar Creator (`https://demo.readyplayer.me/avatar?frameApi`)
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Listening for `v1.avatar.exported` postMessage
            </span>
          </div>

          <div className="w-full h-72 rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
            <iframe
              ref={rpmIframeRef}
              src="https://demo.readyplayer.me/avatar?frameApi"
              title="Ready Player Me 3D Avatar Creator"
              allow="camera *; microphone *; clipboard-write"
              className="w-full h-full border-0"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              value={customGlbInput}
              onChange={(e) => setCustomGlbInput(e.target.value)}
              placeholder="Paste any Ready Player Me .glb URL or select a preset rig..."
              aria-label="Custom GLB Avatar URL"
              className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-mono text-slate-200"
            />
            <button
              type="button"
              onClick={handleLoadCustomGlb}
              className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Load .GLB Rig
            </button>
          </div>
        </div>
      )}

      {/* 3D GLTF Rigged Viewport + Deep Customization Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* Left Column: 3D WebGL GLTF Viewport + Camera Framing Controls */}
        <div className="md:col-span-5 flex flex-col gap-2">
          <div className="relative">
            <div
              ref={canvasMountRef}
              data-testid="avatar-3d-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="w-full h-72 rounded-xl overflow-hidden border border-slate-800 cursor-grab active:cursor-grabbing bg-slate-950"
            />

            {/* Top-left Rig Status Badge */}
            <div className="pointer-events-none absolute top-2.5 left-2.5 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-sky-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>{isLoadingModel ? 'Loading GLTF Rig...' : modelLoadedName}</span>
            </div>

            {/* Bottom Camera Framing Bar (Bust / Waist / Full-Body) */}
            <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between gap-1 bg-slate-950/85 border border-slate-800/90 rounded-lg p-1">
              {(
                [
                  { id: 'bust', label: 'Portrait Bust' },
                  { id: 'waist', label: 'Half Body' },
                  { id: 'full', label: 'Full Rig' },
                ] as const
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => onChangeConfig({ ...config, cameraFraming: cam.id })}
                  className={`flex-1 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                    activeFraming === cam.id
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preset Rigged .GLB Character Switcher */}
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_GLB_MODELS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setCustomGlbInput(preset.url);
                  onChangeConfig({ ...config, avatarGlbUrl: preset.url });
                }}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  activeGlbUrl === preset.url
                    ? 'border-sky-500 bg-sky-500/15 text-sky-300 font-semibold'
                    : 'border-slate-800 hover:bg-slate-800/60 text-slate-400'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Blendshape Expressions, Head-Bone AR Lenses, Hair, Beard & PBR Swatches */}
        <div className="md:col-span-7 space-y-3 text-xs">
          {/* 1. Expression / Blendshape Morph Target Selector */}
          <div>
            <span className="block font-medium text-slate-400 mb-1">
              Snapchat 3D Expression & Pose (GLTF Blendshapes & Rig)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'chill-smile', label: 'Chill Smile' },
                  { id: 'wink-star', label: 'Star Wink' },
                  { id: 'cyber-focus', label: 'Cyber Focus' },
                  { id: 'hype-laugh', label: 'Hype Laugh' },
                ] as const
              ).map((exp) => (
                <button
                  key={exp.id}
                  type="button"
                  onClick={() => onChangeConfig({ ...config, expression: exp.id })}
                  className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                    config.expression === exp.id
                      ? 'border-sky-500 bg-sky-500/20 text-sky-300 font-semibold'
                      : 'border-slate-800 hover:bg-slate-800/60 text-slate-400'
                  }`}
                >
                  {exp.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. 3D AR Lens / Head-Bone Accessory */}
          <div>
            <span className="block font-medium text-slate-400 mb-1">
              3D AR Lens & Headgear (Bound to Skeleton `Head` Bone)
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {(
                [
                  { id: 'cyber-visor', label: 'Cyber Visor' },
                  { id: 'aviator-shades', label: 'Shades' },
                  { id: 'gold-crown', label: 'Crown' },
                  { id: 'studio-headphones', label: 'Headset' },
                  { id: 'none', label: 'None' },
                ] as const
              ).map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => onChangeConfig({ ...config, accessory: acc.id })}
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                    config.accessory === acc.id
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 font-semibold'
                      : 'border-slate-800 hover:bg-slate-800/60 text-slate-400'
                  }`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. 3D Hair / Headwear Style + Facial Hair Toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div className="sm:col-span-8">
              <span className="block font-medium text-slate-400 mb-1">
                3D Hair & Headwear (`Wolf3D_Headwear`)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'cyber-spiky', label: 'Cyber Spikes' },
                    { id: 'sleek-wave', label: 'Sleek Cap' },
                    { id: 'curly-crown', label: 'Curly Halo' },
                    { id: 'minimal-dome', label: 'Minimal' },
                  ] as const
                ).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, hairStyle: h.id })}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                      config.hairStyle === h.id
                        ? 'border-sky-500 bg-sky-500/20 text-sky-300 font-semibold'
                        : 'border-slate-800 hover:bg-slate-800/60 text-slate-400'
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sm:col-span-4">
              <span className="block font-medium text-slate-400 mb-1">
                Facial Hair (`Wolf3D_Beard`)
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'sculpted', label: 'Beard' },
                    { id: 'clean', label: 'Clean' },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, beardStyle: b.id })}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                      activeBeard === b.id
                        ? 'border-sky-500 bg-sky-500/20 text-sky-300 font-semibold'
                        : 'border-slate-800 hover:bg-slate-800/60 text-slate-400'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. PBR Material Color Swatches: Skin Tone, Hair Tone, Outfit, Eye Color, Studio Aura */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <span className="block text-[11px] text-slate-400 mb-1">
                Skin Tone (`Wolf3D_Skin`)
              </span>
              <div className="flex items-center gap-1">
                {SKIN_TONES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Select skin tone ${hex}`}
                    onClick={() => onChangeConfig({ ...config, skinTone: hex })}
                    className={`w-5 h-5 rounded-full border cursor-pointer ${
                      config.skinTone === hex ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] text-slate-400 mb-1">
                Hair & Beard Tone
              </span>
              <div className="flex items-center gap-1">
                {HAIR_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Select hair color ${hex}`}
                    onClick={() => onChangeConfig({ ...config, hairColor: hex })}
                    className={`w-5 h-5 rounded-full border cursor-pointer ${
                      config.hairColor === hex ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] text-slate-400 mb-1">
                Outfit (`Wolf3D_Outfit`)
              </span>
              <div className="flex items-center gap-1">
                {OUTFIT_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Select outfit color ${hex}`}
                    onClick={() => onChangeConfig({ ...config, outfitColor: hex })}
                    className={`w-5 h-5 rounded-full border cursor-pointer ${
                      config.outfitColor === hex ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] text-slate-400 mb-1 flex items-center gap-1">
                <Eye className="w-3 h-3 text-sky-400" />
                <span>Eye Iris (`Wolf3D_Eye`)</span>
              </span>
              <div className="flex items-center gap-1">
                {EYE_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Select eye color ${hex}`}
                    onClick={() => onChangeConfig({ ...config, eyeColor: hex })}
                    className={`w-5 h-5 rounded-full border cursor-pointer ${
                      (config.eyeColor || '#38bdf8') === hex
                        ? 'border-white scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div className="col-span-2 sm:col-span-2">
              <span className="block text-[11px] text-slate-400 mb-1">
                3D Studio Environment Aura
              </span>
              <div className="flex items-center gap-1.5">
                {AURA_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Select studio aura ${hex}`}
                    onClick={() => onChangeConfig({ ...config, bgAura: hex })}
                    className={`w-6 h-5 rounded border cursor-pointer ${
                      (config.bgAura || '#0f172a') === hex
                        ? 'border-sky-400 scale-105'
                        : 'border-slate-700'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="text-xs font-medium text-emerald-400">{statusMessage}</div>
      )}
    </div>
  );
};
