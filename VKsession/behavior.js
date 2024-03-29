import {createScopedThreejs} from 'three.js'
import {registerGLTFLoader} from 'gltf-loader'
import cloneGltf from 'gltf-clone'

export default function getBehavior(options) {
  return Behavior({
    data: {
      width: 1,
      height: 1,
      fps: 0,
    },
    methods: {
      onReady() {
        wx.createSelectorQuery()
          .select('#webgl')
          .node()
          .exec(res => {
            this.canvas = res[0].node
            this.initVK()
          })
      },
      onUnload() {
        if (this.renderer) {
          this.renderer.dispose()
          this.renderer = null
        }
        if (this.scene) {
          this.scene.dispose()
          this.scene = null
        }
        if (this.camera) this.camera = null
        if (this.model) this.model = null
        if (this._insertModels) this._insertModels = null
        if (this.planeBox) this.planeBox = null
        if (this.mixers) {
          this.mixers.forEach(mixer => mixer.uncacheRoot(mixer.getRoot()))
          this.mixers = null
        }
        if (this.clock) this.clock = null
    
        if (this.THREE) this.THREE = null
        if (this._program && this._program.gl) {
          this._program.gl.deleteProgram(this._program)
          this._program = null
        }
        if (this.canvas) this.canvas = null
        if (this.session) this.session = null
      },
      initVK() {
        const isSupportV2 = wx.isVKSupport('v2')
        if (!isSupportV2) return console.error('v2 is not support')

        const session = this.session = wx.createVKSession({
          track: {
            plane: {mode: 3},
          },
          version: 'v2'
        })
        session.start(err => {
          if (err) return console.error('VK error: ', err)

          const info = wx.getSystemInfoSync()
          const pixelRatio = info.pixelRatio
          const canvas = this.canvas

          const calcSize = (width, height) => {
            console.log(`canvas size: width = ${width} , height = ${height}`)

            canvas.width = width * pixelRatio / 2
            canvas.height = height * pixelRatio / 2
            this.setData({
              width,
              height,
            })
          }
          calcSize(info.windowWidth, info.windowHeight)

          session.on('resize', () => {
            const info = wx.getSystemInfoSync()
            calcSize(info.windowWidth, info.windowHeight)
          })

          // 初始化 threejs
          if (options.threejs) this.initTHREE()
          const THREE = this.THREE

          // 太阳系模型
          if (options.spaceModel) {
            const loader = new THREE.GLTFLoader()
            loader.load('https://dcdn.it120.cc/2022/03/28/8d71c70b-217c-4a7a-a54a-f01f2975a1e6.glb', gltf => {
              const model = this.model = gltf.scene
              model.matrixAutoUpdate = false
              model.position.set(0, 0, -0.5)
              model.scale.set(0.1, 0.1, 0.1)
              this.scene.add(model)
            })
          }

          // 平面检测
          if (options.plane) {
            const updateMatrix = (object, m) => {
              object.matrixAutoUpdate = false
              object.matrix.fromArray(m)
            }
            session.on('addAnchors', anchors => {
              anchors.forEach(anchor => {
                console.log('anchor.size', anchor.size)
                const object = new THREE.GridHelper(0.2, 10, 0xffffff, 0xffffff)
                
                object._anchor = anchor
                updateMatrix(object, anchor.transform)
                this.planeBox.add(object)
              })
            })
            session.on('updateAnchors', anchors => {
              const map = anchors.reduce((item, temp) => {
                temp[item.id] = item
                return temp
              }, {})
              this.planeBox.children.forEach(object => {
                if (object._anchor && map[object._anchor.id]) {
                  const anchor = object._anchor
                  object._anchor = anchor
                  updateMatrix(object, anchor.transform)
                }
              })
            })
            session.on('removeAnchors', anchors => {
              const map = anchors.reduce((item, temp) => {
                temp[item.id] = item
                return temp
              }, {})
              this.planeBox.children.forEach(object => {
                if (object._anchor && map[object._anchor.id]) this.planeBox.remove(object)
              })
            })

            // 平面集合
            const planeBox = this.planeBox = new THREE.Object3D()
            this.scene.add(planeBox)
          }

          // 自定义初始化
          if (this.init) this.init()

          // 逐帧渲染
          const onFrame = timestamp => {
            const frame = session.getVKFrame(canvas.width, canvas.height)
            if (frame) {
              this.render(frame)
              this.analysis()
            }

            session.requestAnimationFrame(onFrame)
          }
          session.requestAnimationFrame(onFrame)
        })
      },
      initTHREE() {
        const THREE = this.THREE = createScopedThreejs(this.canvas)
        registerGLTFLoader(THREE)
      
        // 相机
        this.camera = new THREE.Camera()
      
        // 场景
        const scene = this.scene = new THREE.Scene()

        // 光源
        const light1 = new THREE.HemisphereLight(0xffffff, 0x444444) // 半球光
        light1.position.set(0, 0.2, 0)
        scene.add(light1)
        const light2 = new THREE.DirectionalLight(0xffffff) // 平行光
        light2.position.set(0, 0.2, 0.1)
        scene.add(light2)

        // 渲染层
        const renderer = this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true})
        renderer.gammaOutput = true
        renderer.gammaFactor = 2.2
      },
      updateAnimation() {
        const dt = this.clock.getDelta()
        if (this.mixers) this.mixers.forEach(mixer => mixer.update(dt))
      },
      copyRobot() {
        const THREE = this.THREE
        const {scene, animations} = cloneGltf(this.model, THREE)
        scene.scale.set(0.05, 0.05, 0.05)
              
        // 动画混合器
        const mixer = new THREE.AnimationMixer(scene)
        for (let i = 0; i < animations.length; i++) {
          const clip = animations[i]
          if (clip.name === 'Dance') {
            const action = mixer.clipAction(clip)
            action.play()
          }
        }

        this.mixers = this.mixers || []
        this.mixers.push(mixer)

        scene._mixer = mixer
        return scene
      },
      getRobot() {
        const THREE = this.THREE

        const model = new THREE.Object3D()
        model.add(this.copyRobot())

        this._insertModels = this._insertModels || []
        this._insertModels.push(model)
        
        if (this._insertModels.length > 5) {
          const needRemove = this._insertModels.splice(0, this._insertModels.length - 5)
          needRemove.forEach(item => {
            if (item._mixer) {
              const mixer = item._mixer
              this.mixers.splice(this.mixers.indexOf(mixer), 1)
              mixer.uncacheRoot(mixer.getRoot())
            }
            if (item.parent) item.parent.remove(item)
          })
        }

        return model
      },
      onTouchEnd(evt) {
        if (options.hitTest) {
          // 光标处放一个机器人
          if (this.scene && this.model && this.reticle) {
            const model = this.getRobot()
            model.position.copy(this.reticle.position)
            model.rotation.copy(this.reticle.rotation)
            this.scene.add(model)
          }
        }

        if (options.hitTest2) {
          // 点击位置放一个机器人
          const touches = evt.changedTouches.length ? evt.changedTouches : evt.touches
          if (touches.length === 1) {
            const touch = touches[0]
            if (this.session && this.scene && this.model) {
              const hitTestRes = this.session.hitTest(touch.x / this.data.width, touch.y / this.data.height, this.resetPanel)
              this.resetPanel = false
              if (hitTestRes.length) {
                const model = this.getRobot()
                model.matrixAutoUpdate = false
                model.matrix.fromArray(hitTestRes[0].transform)
                this.scene.add(model)
              }
            }
          }
        }
      },
      analysis() {
        if (!this._lastTs) this._lastTs = Date.now()
        const ts = Date.now()

        if (!this._fc) this._fc = this._lastFc = 0        
        this._fc++

        // 1s 统计一次
        if (ts - this._lastTs > 1000) {
          const fps = Math.round((this._fc - this._lastFc) * 1000 / (ts - this._lastTs))
          this._lastFc = this._fc
          
          this.setData({fps})
          this._lastTs = ts
        }
      },
    },
  })
}