const debug = require('debug')('spikenail:ValidationService');

import validator from 'validator';

class ValidationService {

  /**
   * Constructor
   */
  constructor() {
    // TODO: ability to import any custom validation rules
    this.rules = {
      // Required
      required: function () {
        // Transform data to work properly with node validator
        return {
          run: function(x) {
            return !validator.isEmpty(x);
          },
          error: {
            message: 'Field is required',
            code: 1
          }
        };
      },
      // Maximum length
      maxLength: function() {
        return {
          run: (x, config) => validator.isLength(x, { min: 0, max: config.max }),
          error: {
            message: 'Field is too large',
            code: 2
          }
        };
      }
    };
  }

  /**
   * Validate input data based on config
   *
   * @param input
   * @param config
   * @param opts
   */
  async validate(input, config, opts) {
    let errors = [];

    // Iterate rules
    for (let rule of config) {
      let assert = await this.assert(rule, input);

      debug('validate - assert', assert);

      if (assert.isValid) {
        continue;
      }

      errors.push(assert.error);
    }

    return errors;
  }

  /**
   * Check if data corresponds the rule
   *
   * @param rule
   * @param input
   */
  async assert(rule, input) {
    let fn = this.rules[rule.assert];
    if (!fn) {
      throw new Error('Unknown assert');
    }

    // Determine value
    let value = input;
    if (rule.field) {
      value = input[rule.field];
    }

    // Skip validation for empty values except for required and notEmpty
    if ((value === undefined || value === '' || value === null)
      && rule.assert !== 'notEmpty' && rule.assert !== 'required'
    ) {
      return {
        isValid: true
      };
    }

    let assert = fn();

    let error = assert.error;
    // TODO: process error message - substitute variables etc
    error.field = rule.field ? rule.field : null;

    return {
      isValid: assert.run(value, rule, input),
      error: error
    }
  }
}

export default new ValidationService();