import Stats from 'stats.js'
import * as THREE from "three";
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import { Layout } from 'ngraph.forcelayout';
import { VaultGraph } from './Graph3DView';


function createNodeMesh(count: number, material: THREE.Material): THREE.InstancedMesh {
	const geometry = new THREE.SphereGeometry(1, 16, 16);

	const mesh = new THREE.InstancedMesh(geometry, material, count);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

	return mesh;
}

function createLinkGeometry(linkCount: number, material: THREE.Material): THREE.LineSegments {
	const positions = new Float32Array(linkCount * 6);
	const geometry = new THREE.BufferGeometry();

	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	return new THREE.LineSegments(geometry, material);
}

function createLabelMesh(canvas: HTMLCanvasElement) {
	const texture = new THREE.CanvasTexture(canvas);

	const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(canvas.width / 100, canvas.height / 100, 1);
	sprite.center.set(0.5, -2.5);

	return sprite;
}

function makeLabelCanvas(text: string) {
	// We need to create a separate texture therefor canvas for each label
	const canvas = document.createElement("canvas");
	canvas.className = "graph-3d-node-canvas";
	canvas.style.visibility = "hidden";

	const ctx = canvas.getContext('2d');

	if (!ctx) {
		console.error('Could not get 2D context for canvas');
		return canvas;
	}

	ctx.font = '48px sans-serif';
	const metrics = ctx.measureText(text);

	canvas.width = metrics.width + 20;
	canvas.height = 68;

	ctx.fillStyle = 'rgba(10, 10, 10, 0.5)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = 'white';
	ctx.font = '48px sans-serif';
	ctx.fillText(text, 10, 58);

	return canvas;
}

type NodeData = { labelSprite: THREE.Sprite, label: string };

export default class Graph3DRenderer {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: ArcballControls;

	linkMaterial: THREE.LineBasicMaterial;
	sphereMaterial: THREE.MeshLambertMaterial;

	instancedSpheres: THREE.InstancedMesh;
	linkMesh: THREE.LineSegments;
	nodesData: NodeData[];

	stats: Stats;

	constructor(container: HTMLElement) {
		// Scene setup
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 10000);

		// TODO: Animate the camera out according to graph
		this.camera.position.z = 200;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setSize(container.clientWidth, container.clientHeight);
		this.renderer.shadowMap.enabled = true;

		container.appendChild(this.renderer.domElement);
		this.renderer.domElement.style.width = "100%";
		this.renderer.domElement.style.height = "100%";
		this.renderer.domElement.style.position = "absolute";

		// Controls
		this.controls = new ArcballControls(this.camera, this.renderer.domElement, this.scene);
		this.controls.setGizmosVisible(false);

		// Materials
		this.linkMaterial = new THREE.LineBasicMaterial({ color: 0xa0a0a0, transparent: true, opacity: 0.6 });
		this.sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

		// Lighting
		this.scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		this.scene.add(light);

		// Stats
		this.stats = new Stats();
		this.stats.showPanel(0);
		this.stats.dom.style.position = 'absolute';
		this.stats.dom.style.top = '10px';
		this.stats.dom.style.right = '10px';
		this.stats.dom.style.left = 'auto';

		container.appendChild(this.stats.dom);
	}

	initializeMeshes(nodeCount: number, linkCount: number) {
		this.nodesData = [];

		this.instancedSpheres = createNodeMesh(nodeCount, this.sphereMaterial);
		this.scene.add(this.instancedSpheres);

		this.linkMesh = createLinkGeometry(linkCount, this.linkMaterial);
		this.scene.add(this.linkMesh);
	}

	updateNodeColors(graph: VaultGraph) {
		graph.forEachNode(node => {
			const color = node.data.resolved ? 0xffffff * Math.random() : 0x404040;
			this.setNodeColor(node.id as number, new THREE.Color(color));
		});
	}

	private setNodeColor(nodeId: number, color: THREE.Color) {
		this.instancedSpheres.setColorAt(nodeId, color);
	}

	createNodeLabels(graph: VaultGraph, container: HTMLElement) {
		graph.forEachNode(node => {
			const labelCanvas = makeLabelCanvas(node.data.label as string);
			const labelSprite = createLabelMesh(labelCanvas);
			this.scene.add(labelSprite);

			const nodeData = { labelSprite, label: node.data.label };
			this.nodesData[node.id as number] = nodeData;
		});
	}

	updateNodePositions(layout: Layout<VaultGraph>) {
		const { graph } = layout;

		// Instance buffer has 16xfp32 per instance (a 4x4 Matrix)
		const sphereBufferCapacity = this.instancedSpheres.instanceMatrix.count;
		if (graph.getNodeCount() > sphereBufferCapacity) {
			this.scene.remove(this.instancedSpheres);
			this.instancedSpheres.dispose();

			const newSize = 2 * sphereBufferCapacity;
			this.instancedSpheres = createNodeMesh(newSize, this.sphereMaterial);
			this.scene.add(this.instancedSpheres);
		}

		layout.forEachBody((body, nodeId: number) => {
			const position = new THREE.Vector3(body.pos.x, body.pos.y, body.pos.z ?? 0);
			const matrix = new THREE.Matrix4().makeTranslation(position);

			this.instancedSpheres.setMatrixAt(nodeId, matrix);
			const labelSprite = this.nodesData[nodeId]?.labelSprite;

			if (labelSprite) {
				labelSprite.position.copy(position);
				labelSprite.geometry.computeBoundingSphere();
			}
		});

		this.instancedSpheres.count = graph.getNodeCount();

		this.instancedSpheres.instanceMatrix.needsUpdate = true;
		this.instancedSpheres.computeBoundingSphere();
	}

	updateLinkPositions(layout: Layout<VaultGraph>) {
		// Link geometry has two positions per 
		const linkBufferCapacity = this.linkMesh.geometry.getAttribute('position').count / 2;
		if (layout.graph.getLinkCount() > linkBufferCapacity) {
			this.scene.remove(this.linkMesh);
			this.linkMesh.geometry.dispose();

			this.linkMesh = createLinkGeometry(2 * linkBufferCapacity, this.linkMaterial);
			this.scene.add(this.linkMesh);
		}

		const linePositionAttribute = this.linkMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
		layout.graph.forEachLink((link) => {
			const { from, to } = layout.getLinkPosition(link.id);

			linePositionAttribute.setXYZ(link.data, from.x, from.y, from.z ?? 0);
			linePositionAttribute.setXYZ(link.data + 1, to.x, to.y, to.z ?? 0);
		});

		this.linkMesh.geometry.setDrawRange(0, 2 * layout.graph.getLinkCount());
		linePositionAttribute.needsUpdate = true;
		this.linkMesh.geometry.computeBoundingSphere();
	}

	updateViewSize() {
		const canvas = this.renderer.domElement;

		const { width, height, clientWidth, clientHeight } = canvas;

		const needResize = width !== clientWidth || height !== clientHeight;
		if (needResize) {
			this.camera.aspect = clientWidth / clientHeight;
			this.camera.updateProjectionMatrix();

			this.renderer.setSize(clientWidth, clientHeight, false);
		}

		return needResize;
	}

	render() {
		this.renderer.render(this.scene, this.camera);
	}

	dispose() {
		this.renderer.dispose();
		this.instancedSpheres?.dispose();
		this.linkMesh?.geometry.dispose();
	}

}
