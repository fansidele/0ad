/**
 * =========================================================================
 * File        : Model.h
 * Project     : 0 A.D.
 * Description : Mesh object with texture and skinning information
 * =========================================================================
 */

#ifndef INCLUDED_MODEL
#define INCLUDED_MODEL

#include <vector>

#include "Texture.h"
#include "MeshManager.h"
#include "RenderableObject.h"
#include "Material.h"
#include "ps/Overlay.h"
struct SPropPoint;
class CObjectEntry;
class CSkeletonAnim;
class CSkeletonAnimDef;
class CSkeletonAnimManager;

#define MODELFLAG_CASTSHADOWS		(1<<0)
#define MODELFLAG_NOLOOPANIMATION	(1<<1)

///////////////////////////////////////////////////////////////////////////////
// CModel: basically, a mesh object - holds the texturing and skinning 
// information for a model in game
class CModel : public CRenderableObject, noncopyable
{
	friend class CUnitAnimation;
		// HACK - we should probably move the rest of this class's animation state
		// into the animation class, then it wouldn't need friend access

public:
	struct Prop {
		Prop() : m_Point(0), m_Model(0), m_ObjectEntry(0) {}

		SPropPoint* m_Point;
		CModel* m_Model;
		CObjectEntry* m_ObjectEntry;
	};

public:
	// constructor
	CModel(CSkeletonAnimManager& skeletonAnimManager);
	// destructor
	~CModel();

	// setup model from given geometry
	bool InitModel(const CModelDefPtr& modeldef);
	// calculate the world space bounds of this model
	void CalcBounds();
	// update this model's state; 'time' is the time since the last update, in MS
	void Update(float time);
	// returns true if Update(time) will require a new animation (due to the
	// current one ending)
	bool NeedsNewAnim(float time) const;

	// get the model's geometry data
	CModelDefPtr GetModelDef() { return m_pModelDef; }

	// set the model's texture
	void SetTexture(const CTexture& tex) { m_Texture=tex; }
	// set the model's material
	void SetMaterial(const CMaterial &material);
	// set the model's player ID, recursively through props. CUnit::SetPlayerID
	// should normally be used instead.
	void SetPlayerID(size_t id);
	// set the model's player colour
	void SetPlayerColor(CColor& colour);
	// set the models mod color
	void SetShadingColor(CColor& colour);
	// get the model's texture
	CTexture* GetTexture() { return &m_Texture; }
	// get the models material
	CMaterial &GetMaterial() { return m_Material; }
	// get the model's texture
	CColor GetShadingColor() { return m_ShadingColor; }

	// set the given animation as the current animation on this model
	bool SetAnimation(CSkeletonAnim* anim, bool once = false, float speed = 1000.0f, CSkeletonAnim* next = NULL);

	// get the currently playing animation, if any
	CSkeletonAnim* GetAnimation() const { return m_Anim; }

	// set the animation state to be the same as from another; both models should
	// be compatible types (same type of skeleton)
	void CopyAnimationFrom(CModel* source);

	// set object flags
	void SetFlags(int flags) { m_Flags=flags; }
	// get object flags
	int GetFlags() const { return m_Flags; }

	// recurse down tree setting dirty bits
	void SetDirtyRec(int dirtyflags) {
		SetDirty(dirtyflags);
		for (size_t i=0;i<m_Props.size();i++) {
			m_Props[i].m_Model->SetDirtyRec(dirtyflags);
		}
	}

	// calculate object space bounds of this model, based solely on vertex positions
	void CalcObjectBounds();
	// calculate bounds encompassing all vertex positions for given animation 
	void CalcAnimatedObjectBound(CSkeletonAnimDef* anim,CBound& result);

	/**
	 * Set transform of this object.
	 * 
	 * @note In order to ensure that all child props are updated properly,
	 * you must call ValidatePosition().
	 */
	void SetTransform(const CMatrix3D& transform);
	
	/**
	 * Return whether this is a skinned/skeletal model. If it is, Get*BoneMatrices()
	 * will return valid non-NULL arrays.
	 */
	bool IsSkinned() { return (m_BoneMatrices != NULL); }

	// return the models bone matrices
	const CMatrix3D* GetAnimatedBoneMatrices() { 
		debug_assert(m_PositionValid);
		return m_BoneMatrices;
	}
	const CMatrix3D* GetInverseBindBoneMatrices() { 
		return m_InverseBindBoneMatrices;
	}

	// load raw animation frame animation from given file, and build a 
	// animation specific to this model
	CSkeletonAnim* BuildAnimation(const char* filename, const char* name, float speed, double actionpos, double actionpos2);

	// add a prop to the model on the given point
	void AddProp(SPropPoint* point, CModel* model, CObjectEntry* objectentry);
	// remove a prop from the given point
	void RemoveProp(SPropPoint* point);
	// return prop list
	std::vector<Prop>& GetProps() { return m_Props; }
	const std::vector<Prop>& GetProps() const { return m_Props; }

	// return a clone of this model
	CModel* Clone() const;

	/**
	 * Ensure that both the transformation and the bone
	 * matrices are correct for this model and all its props.
	 */
	void ValidatePosition();

private:
	// delete anything allocated by the model
	void ReleaseData();

	/**
	 * Mark this model's position and bone matrices,
	 * and all props' positions as invalid.
	 */
	void InvalidatePosition();
	
	/**
	 * If non-null, m_Parent points to the model that we
	 * are attached to.
	 */
	CModel* m_Parent;

	// object flags
	int m_Flags;
	// texture used by model
	CTexture m_Texture;
	// model's material
	CMaterial m_Material;
	// pointer to the model's raw 3d data
	CModelDefPtr m_pModelDef;
	// object space bounds of model - accounts for bounds of all possible animations
	// that can play on a model. Not always up-to-date - currently CalcBounds()
	// updates it when necessary.
	CBound m_ObjectBounds;
	// animation currently playing on this model, if any
	CSkeletonAnim* m_Anim;
	// animation to switch back to when the current one finishes
	CSkeletonAnim* m_NextAnim;
	// rate at which the animation should play
	float m_AnimSpeed;
	// time (in MS) into the current animation
	float m_AnimTime;
	// current state of all bones on this model; null if associated modeldef isn't skeletal
	CMatrix3D* m_BoneMatrices;
	// inverse matrices for the bind pose's bones; null if not skeletal
	CMatrix3D* m_InverseBindBoneMatrices;
	// list of current props on model
	std::vector<Prop> m_Props;

	/**
	 * true if both transform and and bone matrices are valid.
	 */
	bool m_PositionValid;

	// modulating color
	CColor m_ShadingColor;

	// manager object which can load animations for us
	CSkeletonAnimManager& m_SkeletonAnimManager;
};

#endif
