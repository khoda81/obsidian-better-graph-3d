import Stats from 'stats.js'
import * as THREE from "three";
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import { Body, Layout } from 'ngraph.forcelayout';
import { VaultGraph } from './Graph3DView';

class NodeLabel {
	labelFont = '48px sans-serif';

	text: string;
	canvas: HTMLCanvasElement;
	sprite: THREE.Sprite<THREE.Object3DEventMap>;

	constructor(text: string) {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "graph-3d-node-canvas";
		this.canvas.style.visibility = "hidden";

		const texture = new THREE.CanvasTexture(this.canvas);
		const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
		this.sprite = new THREE.Sprite(material);

		// Transform the sprite up
		this.sprite.center.set(0.5, -2.5);
		this.setText(text);
	}

	setText(text: string) {
		if (this.text === text) { return; }
		const ctx = this.canvas.getContext('2d');

		if (!ctx) {
			console.error(`Could not get 2D context for ${this.canvas}`);
			return;
		}

		// We need to create a separate texture therefor canvas for each label
		ctx.font = this.labelFont;
		const metrics = ctx.measureText(text);

		this.canvas.width = metrics.width + 20;
		this.canvas.height = 68;

		ctx.fillStyle = 'rgba(10, 10, 10, 0.5)';
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		ctx.fillStyle = 'white';
		ctx.font = this.labelFont;
		ctx.fillText(text, 10, 58);

		// Scale down the sprite by a factor of 100
		this.sprite.scale.set(this.canvas.width / 100, this.canvas.height / 100, 1);
		this.text = text;
	}

	dispose() {
		this.canvas.remove();
		this.sprite.removeFromParent();
		this.sprite.material.dispose();
	}
}


type NodeData = { label: NodeLabel };

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

	private readonly sphereGeometry = new THREE.SphereGeometry(1, 16, 16);

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
		this.linkMaterial = new THREE.LineBasicMaterial({
			color: 0xa0a0a0,
			transparent: true,
			opacity: 0.6,
			depthWrite: true,
			depthTest: true,
		});

		this.sphereMaterial = new THREE.MeshLambertMaterial({
			color: 0xffffff,
			transparent: false,
			opacity: 1.0,
			depthWrite: true,
			depthTest: true,
		});

		// Lighting
		this.scene.add(new THREE.AmbientLight(0x808080));
		const light = new THREE.DirectionalLight(0xffffff, 1);
		light.position.set(5, 0, 0);
		this.scene.add(light);

		// Stats
		this.stats = new Stats();
		this.stats.showPanel(2);
		this.stats.dom.style.position = 'absolute';
		this.stats.dom.style.top = '10px';
		this.stats.dom.style.right = '10px';
		this.stats.dom.style.left = 'auto';

		container.appendChild(this.stats.dom);
	}

	private createSphereMesh(count: number, material: THREE.Material): THREE.InstancedMesh {
		const instancedSpheres = new THREE.InstancedMesh(this.sphereGeometry, material, count);
		instancedSpheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

		return instancedSpheres;
	}

	private createLinkMesh(linkCount: number, material: THREE.Material): THREE.LineSegments {
		const positions = new Float32Array(linkCount * 6);
		const geometry = new THREE.BufferGeometry();

		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		return new THREE.LineSegments(geometry, material);
	}

	initializeBuffers(nodeCount: number, linkCount: number) {
		this.nodesData = [];

		this.instancedSpheres = this.createSphereMesh(nodeCount, this.sphereMaterial);
		this.scene.add(this.instancedSpheres);

		this.linkMesh = this.createLinkMesh(linkCount, this.linkMaterial);
		this.scene.add(this.linkMesh);
	}

	setNodeColor(nodeId: number, color: THREE.Color) {
		this.instancedSpheres.setColorAt(nodeId, color);
	}

	setNodeLabel(nodeId: number, labelText: string) {
		let label = this.nodesData[nodeId]?.label;

		// If label does not exist, create one
		if (!label) {
			label = new NodeLabel(labelText);
			this.scene.add(label.sprite);
		}

		this.nodesData[nodeId] = { label };
	}

	private setNodePosition(body: Body, nodeId: number) {
		const position = new THREE.Vector3(body.pos.x, body.pos.y, body.pos.z ?? 0);
		const matrix = new THREE.Matrix4().makeTranslation(position);

		this.instancedSpheres.setMatrixAt(nodeId, matrix);
		const labelSprite = this.nodesData[nodeId]?.label.sprite;

		if (labelSprite) {
			labelSprite.position.copy(position);
			labelSprite.geometry.computeBoundingSphere();
		}
	}

	updateNodePositions(layout: Layout<VaultGraph>) {
		const { graph } = layout;

		// Instance buffer has 16xfp32 per instance (a 4x4 Matrix)
		const sphereBufferCapacity = this.instancedSpheres.instanceMatrix.count;
		if (graph.getNodeCount() > sphereBufferCapacity) {
			// Need to create a new instanced mesh, since we ran out of space.
			const newSize = 2 * sphereBufferCapacity;
			const newInstances = this.createSphereMesh(newSize, this.sphereMaterial);

			// Copy the matrices from the previous mesh
			newInstances.instanceMatrix.set(this.instancedSpheres.instanceMatrix.array);
			if (this.instancedSpheres.instanceColor && newInstances.instanceColor) {
				newInstances.instanceColor.set(this.instancedSpheres.instanceColor.array);
			}

			this.scene.remove(this.instancedSpheres);
			this.instancedSpheres.dispose();

			this.instancedSpheres = newInstances;
			this.scene.add(newInstances);
		}

		layout.forEachBody((body, nodeId: number) => {
			this.setNodePosition(body, nodeId)
		});

		this.instancedSpheres.count = graph.getNodeCount();
		this.instancedSpheres.instanceMatrix.needsUpdate = true;

		this.instancedSpheres.computeBoundingSphere();
	}

	updateLinkPositions(layout: Layout<VaultGraph>) {
		// Link geometry has two positions per 
		const linkBufferCapacity = this.linkMesh.geometry.getAttribute('position').count / 2;
		if (layout.graph.getLinkCount() > linkBufferCapacity) {
			const newMesh = this.createLinkMesh(2 * linkBufferCapacity, this.linkMaterial);
			const newGeometry = newMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

			const oldGeometry = this.linkMesh.geometry.getAttribute('position') as THREE.BufferAttribute
			newGeometry.set(oldGeometry.array);

			this.scene.remove(this.linkMesh);
			this.linkMesh.geometry.dispose();

			this.linkMesh = newMesh;
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
		this.nodesData.forEach(({ label }) => {
			this.scene.remove(label.sprite);
			label.dispose();
		});
	}

}
