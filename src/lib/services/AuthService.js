import Spikenail from '../Spikenail';

class AuthService {

  async authenticate(token) {
    // request current user by token
    // TODO: user model is hardcoded as user, probably, make it configurable
    if (Spikenail.models.user) {
      return await Spikenail.models.user.model.findOne({ "tokens.token": token });
    }

    return false;
  }
}

export default new AuthService();